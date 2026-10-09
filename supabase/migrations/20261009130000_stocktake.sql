-- Observations only: no lifecycle, sale or seller-balance mutations.
create table public.stocktake_sessions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 created_by uuid not null references auth.users(id),
 actor_name text not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create table public.stocktake_expected_items (
 tenant_id uuid not null,
 session_id uuid not null,
 item_id uuid not null,
 title text not null,
 primary key(tenant_id,session_id,item_id),
 foreign key(tenant_id,session_id) references public.stocktake_sessions(tenant_id,id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create table public.stocktake_events (
 id uuid primary key,
 tenant_id uuid not null,
 session_id uuid not null,
 seq integer not null check(seq>0),
 kind text not null check(kind in ('scan','finding','closed')),
 item_id uuid,
 observation text check(observation in ('found','missing','damaged')),
 reason text not null check(length(reason)<=500),
 input jsonb not null,
 changed_items uuid[] not null default '{}',
 created_by uuid not null references auth.users(id),
 actor_name text not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,session_id,seq),
 foreign key(tenant_id,session_id) references public.stocktake_sessions(tenant_id,id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 check((kind='closed' and item_id is null and observation is null) or
       (kind<>'closed' and item_id is not null and observation is not null)),
 check(kind<>'finding' or length(trim(reason))>0)
);
create unique index stocktake_one_close on public.stocktake_events(tenant_id,session_id) where kind='closed';
create index stocktake_item_history on public.stocktake_events(tenant_id,session_id,item_id,seq desc);
create index stocktake_recent on public.stocktake_sessions(tenant_id,created_at desc,id);
do $$ declare t text; begin
 foreach t in array array['stocktake_sessions','stocktake_expected_items','stocktake_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy stocktake_read on public.%I for select to authenticated using(tenant_id in(select public.user_tenant_ids()))',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create trigger stocktake_immutable before update or delete on public.%I for each row execute function komisio_private.preserve_operation()',t);
  execute format('create trigger stocktake_plan before insert on public.%I for each row execute function komisio_private.plan_gate()',t);
 end loop;
end $$;

-- Exactly the existing stock-report definition, shared by snapshots and changes.
create function komisio_private.stocktake_in_stock(p_tenant uuid,p_item uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.items i where i.tenant_id=p_tenant and i.id=p_item)
 and not exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=p_item and e.kind='period_ended')
 and not exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
 where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed'
 and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id));
$$;
revoke all on function komisio_private.stocktake_in_stock(uuid,uuid) from public,anon,authenticated;

create function public.start_stocktake(p_tenant uuid,p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.stocktake_sessions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.stocktake_sessions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.stocktake_sessions s where s.tenant_id=p_tenant and not exists(select 1 from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=s.id and e.kind='closed')) then raise exception 'STOCKTAKE_OPEN'; end if;
 insert into public.stocktake_sessions(id,tenant_id,created_by,actor_name) values(p_id,p_tenant,uid,coalesce((select display_name from public.user_profiles where user_id=uid),''));
 insert into public.stocktake_expected_items(tenant_id,session_id,item_id,title)
 select p_tenant,p_id,i.id,coalesce(komisio_private.item_title(p_tenant,i.id)->>'title','') from public.items i where i.tenant_id=p_tenant and komisio_private.stocktake_in_stock(p_tenant,i.id);
 perform komisio_private.record_access(p_tenant,'stocktake.started',p_id,'{}');
 return p_id;
end $$;

create function public.record_stocktake(p_tenant uuid,p_id uuid,p_session uuid,p_kind text,p_reference text,p_item uuid,p_expected integer,p_observation text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.stocktake_events; latest public.stocktake_events;
 input jsonb; ref text:=upper(trim(p_reference)); reason text:=trim(p_reason); item uuid:=p_item; matches uuid[]; version integer; observation text; changed uuid[]:='{}';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_session is null or p_kind is null or p_kind not in ('scan','finding','closed') or ref is null or length(ref)>64 or reason is null or length(reason)>500 then raise exception 'INVALID_INPUT'; end if;
 if (p_kind='scan' and (ref='' or p_item is not null or p_expected is not null or p_observation is not null or reason<>''))
 or (p_kind='finding' and (ref<>'' or p_item is null or p_expected is null or p_expected<0 or p_observation is null or p_observation not in ('found','missing','damaged') or reason=''))
 or (p_kind='closed' and (ref<>'' or p_item is not null or p_expected is null or p_expected<0 or p_observation is not null or reason<>'')) then raise exception 'INVALID_INPUT'; end if;
 input:=jsonb_build_object('kind',p_kind,'reference',ref,'item',p_item,'expected',p_expected,'observation',p_observation,'reason',reason);
 select * into prior from public.stocktake_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.created_by is distinct from uid or prior.input<>input then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.stocktake_sessions where tenant_id=p_tenant and id=p_session) then raise exception 'STOCKTAKE_NOT_FOUND'; end if;
 if exists(select 1 from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and kind='closed') then raise exception 'STOCKTAKE_CLOSED'; end if;
 select coalesce(max(seq),0) into version from public.stocktake_events where tenant_id=p_tenant and session_id=p_session;
 if version>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 if p_kind='closed' then
  if p_expected<>version then raise exception 'STOCKTAKE_CHANGED'; end if;
  if exists(select 1 from public.stocktake_expected_items x where x.tenant_id=p_tenant and x.session_id=p_session and komisio_private.stocktake_in_stock(p_tenant,x.item_id)
   and not exists(select 1 from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session and e.item_id=x.item_id)) then raise exception 'STOCKTAKE_PENDING'; end if;
  select coalesce(array_agg(x.item_id),'{}') into changed from public.stocktake_expected_items x where x.tenant_id=p_tenant and x.session_id=p_session and not komisio_private.stocktake_in_stock(p_tenant,x.item_id);
 else
  if p_kind='scan' then
   if ref ~ '^I-?[0-9A-F]{8}$' then
    select array_agg(id) into matches from (select id from public.items where tenant_id=p_tenant and
     id >= (right(ref,8)||'-0000-0000-0000-000000000000')::uuid and id <= (right(ref,8)||'-ffff-ffff-ffff-ffffffffffff')::uuid limit 2) m;
    if coalesce(cardinality(matches),0)>1 then raise exception 'STOCKTAKE_AMBIGUOUS'; end if;
    item:=matches[1];
   elsif ref ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then item:=ref::uuid;
   else raise exception 'INVALID_INPUT'; end if;
  end if;
  if item is null or not exists(select 1 from public.items where tenant_id=p_tenant and id=item) then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into latest from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and item_id=item order by seq desc limit 1;
  if p_kind='finding' then
   if coalesce(latest.seq,0)<>p_expected then raise exception 'STOCKTAKE_CHANGED'; end if;
   if not exists(select 1 from public.stocktake_expected_items where tenant_id=p_tenant and session_id=p_session and item_id=item) and latest.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
   observation:=p_observation;
  else observation:=case when latest.observation='damaged' then 'damaged' else 'found' end; end if;
 end if;
 insert into public.stocktake_events(id,tenant_id,session_id,seq,kind,item_id,observation,reason,input,changed_items,created_by,actor_name)
 values(p_id,p_tenant,p_session,version+1,p_kind,item,observation,reason,input,changed,uid,coalesce((select display_name from public.user_profiles where user_id=uid),''));
 perform komisio_private.record_access(p_tenant,'stocktake.'||p_kind,p_session,jsonb_build_object('event',p_id,'seq',version+1));
 return p_id;
end $$;

create function public.stocktake_sessions_page(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(s) order by s.closed,s.at desc,s.id) from (
  select s.id,s.created_at as at,s.actor_name as actor,exists(select 1 from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=s.id and e.kind='closed') as closed
  from public.stocktake_sessions s where s.tenant_id=p_tenant order by closed,s.created_at desc,s.id limit 20) s),'[]');
end $$;

create function public.stocktake_report(p_tenant uuid,p_session uuid,p_filter text,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare closing public.stocktake_events; result jsonb; history jsonb; version integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_filter is null or p_filter not in ('all','unchecked','deviations') or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.stocktake_sessions where tenant_id=p_tenant and id=p_session) then raise exception 'STOCKTAKE_NOT_FOUND'; end if;
 select * into closing from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and kind='closed';
 select coalesce(max(seq),0) into version from public.stocktake_events where tenant_id=p_tenant and session_id=p_session;
 with item_ids as (
 select item_id from public.stocktake_expected_items where tenant_id=p_tenant and session_id=p_session
 union select item_id from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and item_id is not null
 ), rows as materialized (
 select i.item_id as id,coalesce(x.title,komisio_private.item_title(p_tenant,i.item_id)->>'title','') as title,
  x.item_id is not null as expected,coalesce(e.observation,'unchecked') as observation,coalesce(e.seq,0) as version,
  coalesce(e.reason,'') as reason,coalesce(e.actor_name,'') as actor,e.created_at as at,
  x.item_id is not null and case when closing.id is not null then i.item_id=any(closing.changed_items) else not komisio_private.stocktake_in_stock(p_tenant,i.item_id) end as changed
 from item_ids i left join public.stocktake_expected_items x on x.tenant_id=p_tenant and x.session_id=p_session and x.item_id=i.item_id
 left join lateral(select * from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session and e.item_id=i.item_id order by seq desc limit 1) e on true
 ), filtered as (
 select * from rows where p_filter='all' or (p_filter='unchecked' and observation='unchecked' and not changed) or (p_filter='deviations' and (observation in ('missing','damaged') or not expected or changed))
 ) select jsonb_build_object('id',p_session,'closed',closing.id is not null,'version',version,
 'counts',(select jsonb_build_object('total',count(*),'unchecked',count(*) filter(where observation='unchecked' and not changed),'deviations',count(*) filter(where observation in ('missing','damaged') or not expected or changed)) from rows),
 'matching',(select count(*) from filtered),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.title,r.id) from (select * from filtered order by title,id limit 50 offset p_offset) r),'[]')) into result;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.seq desc),'[]') into history from (
  select e.seq,e.kind,e.observation,e.reason,e.item_id,e.actor_name as actor,e.created_at as at from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session order by seq desc limit 20) h;
 return result||jsonb_build_object('history',history);
end $$;
revoke all on function public.start_stocktake(uuid,uuid),public.record_stocktake(uuid,uuid,uuid,text,text,uuid,integer,text,text),public.stocktake_sessions_page(uuid),public.stocktake_report(uuid,uuid,text,integer) from public,anon;
grant execute on function public.start_stocktake(uuid,uuid),public.record_stocktake(uuid,uuid,uuid,text,text,uuid,integer,text,text),public.stocktake_sessions_page(uuid),public.stocktake_report(uuid,uuid,text,integer) to authenticated;
