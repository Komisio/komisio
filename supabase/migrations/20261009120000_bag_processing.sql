-- Explicit whole-drop-off progress, separate from custody and item lifecycle.
create table public.bag_processing_events (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 bag_id uuid not null,
 version integer not null check(version>0),
 state text not null check(state in ('open','completed')),
 reason text not null check(length(reason)<=500),
 created_by uuid not null references auth.users(id),
 actor_name text not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,bag_id,version),
 foreign key(tenant_id,bag_id) references public.bag_receipts(tenant_id,id),
 check(state='completed' or length(trim(reason))>0)
);
alter table public.bag_processing_events enable row level security;
create policy bag_processing_read on public.bag_processing_events for select to authenticated
 using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.bag_processing_events from public,anon,authenticated;
grant select on public.bag_processing_events to authenticated;
create trigger bag_processing_immutable before update or delete on public.bag_processing_events for each row execute function komisio_private.preserve_operation();
create trigger bag_processing_plan before insert on public.bag_processing_events for each row execute function komisio_private.plan_gate();

create function public.bag_processing(p_tenant uuid,p_bag uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare latest public.bag_processing_events; history jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select * into latest from public.bag_processing_events where tenant_id=p_tenant and bag_id=p_bag order by version desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('version',h.version,'state',h.state,'reason',h.reason,'at',h.created_at,'actor',h.actor_name) order by h.version desc),'[]') into history
 from (select * from public.bag_processing_events where tenant_id=p_tenant and bag_id=p_bag order by version desc limit 20) h;
 return jsonb_build_object('state',coalesce(latest.state,'open'),'version',coalesce(latest.version,0),'history',history);
end $$;

create function public.set_bag_processing(p_tenant uuid,p_id uuid,p_bag uuid,p_expected integer,p_state text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.bag_processing_events; latest public.bag_processing_events; work jsonb; reason text:=trim(p_reason);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_bag is null or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_state is null or p_state not in ('open','completed') or reason is null or length(reason)>500 or (p_state='open' and reason='') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.bag_processing_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.bag_id is distinct from p_bag or prior.created_by is distinct from uid or prior.version<>p_expected+1 or prior.state<>p_state or prior.reason<>reason then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select * into latest from public.bag_processing_events where tenant_id=p_tenant and bag_id=p_bag order by version desc limit 1;
 if coalesce(latest.version,0)<>p_expected or coalesce(latest.state,'open')=p_state then raise exception 'BAG_PROCESSING_CHANGED'; end if;
 if p_state='completed' then
  work:=public.bag_work_summary(p_tenant,p_bag);
  if (work->>'drafts')::integer>0 or (work->>'receptions')::integer>0 then raise exception 'BAG_PENDING_WORK'; end if;
 end if;
 insert into public.bag_processing_events(id,tenant_id,bag_id,version,state,reason,created_by,actor_name)
 values(p_id,p_tenant,p_bag,p_expected+1,p_state,reason,uid,coalesce((select display_name from public.user_profiles where user_id=uid),''));
 perform komisio_private.record_access(p_tenant,'bag.processing_changed',p_bag,jsonb_build_object('version',p_expected+1,'state',p_state));
 return p_id;
end $$;
revoke all on function public.bag_processing(uuid,uuid),public.set_bag_processing(uuid,uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.bag_processing(uuid,uuid),public.set_bag_processing(uuid,uuid,uuid,integer,text,text) to authenticated;

-- Serialize preparation with completion, including requests from already-open tabs.
-- Existing successful engine retries return before these insert triggers.
create function komisio_private.guard_completed_bag() returns trigger
language plpgsql security definer set search_path='' as $$
declare bag uuid;
begin
 if tg_table_name='items' then
  if new.origin_kind='inspection_draft' then select bag_id into bag from public.inspection_draft_revisions where tenant_id=new.tenant_id and draft_id=new.origin_id limit 1;
  elsif new.origin_kind='reception_review' then select bag_id into bag from public.reception_sessions where tenant_id=new.tenant_id and id=new.origin_id; end if;
 elsif tg_table_name in ('inspection_draft_revisions','reception_sessions') then bag:=new.bag_id;
 else select bag_id into bag from public.reception_sessions where tenant_id=new.tenant_id and id=new.session_id; end if;
 if bag is null then return new; end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if (select state from public.bag_processing_events where tenant_id=new.tenant_id and bag_id=bag order by version desc limit 1)='completed' then raise exception 'BAG_COMPLETED'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_completed_bag() from public,anon,authenticated;
create trigger inspection_bag_open before insert on public.inspection_draft_revisions for each row execute function komisio_private.guard_completed_bag();
create trigger reception_bag_open before insert on public.reception_sessions for each row execute function komisio_private.guard_completed_bag();
create trigger sources_bag_open before insert on public.reception_source_revisions for each row execute function komisio_private.guard_completed_bag();
create trigger reviews_bag_open before insert on public.reception_reviews for each row execute function komisio_private.guard_completed_bag();
create trigger item_bag_open before insert on public.items for each row execute function komisio_private.guard_completed_bag();

create or replace function public.bag_queue_page(p_tenant uuid,p_seller uuid,p_reference bigint,p_older bigint,p_newer bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_older is not null and p_newer is not null then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(r.row order by r.sort) from (
   select jsonb_build_object('id',b.id,'seller_id',b.seller_id,'reference',b.reference,
    'processing_state',coalesce((select e.state from public.bag_processing_events e where e.tenant_id=p_tenant and e.bag_id=b.id order by e.version desc limit 1),'open'),'note',b.note,'received_at',b.received_at,'sellers',jsonb_build_object('name',s.name)) as row,
    case when p_newer is null then -b.reference else b.reference end as sort
   from public.bag_receipts b join public.sellers s on s.id=b.seller_id and s.tenant_id=b.tenant_id
   where b.tenant_id=p_tenant
    and (p_seller is null or b.seller_id=p_seller)
    and (p_reference is null or b.reference=p_reference)
    and (p_older is null or b.reference<p_older)
    and (p_newer is null or b.reference>p_newer)
   order by 2
   limit 21) r),'[]'::jsonb);
end $$;
revoke all on function public.bag_queue_page(uuid,uuid,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.bag_queue_page(uuid,uuid,bigint,bigint,bigint) to authenticated;

create or replace function public.flow_dropoffs(p_tenant uuid,p_state text)
returns setof public.bag_receipts language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_state is null or p_state not in ('unstarted','drafts','open','completed') then raise exception 'INVALID_INPUT'; end if;
 return query select b.* from public.bag_receipts b where b.tenant_id=p_tenant and
 coalesce((select e.state from public.bag_processing_events e where e.tenant_id=p_tenant and e.bag_id=b.id order by e.version desc limit 1),'open')=case when p_state='completed' then 'completed' else 'open' end and
 case when p_state in ('open','completed') then true when p_state='unstarted' then
 not exists(select 1 from public.inspection_draft_revisions d where d.tenant_id=b.tenant_id and d.bag_id=b.id)
 and not exists(select 1 from public.reception_sessions s where s.tenant_id=b.tenant_id and s.bag_id=b.id)
 else exists(select 1 from public.inspection_draft_revisions d where d.tenant_id=b.tenant_id and d.bag_id=b.id
 and not exists(select 1 from public.items i where i.tenant_id=d.tenant_id and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id)) end;
end $$;
revoke all on function public.flow_dropoffs(uuid,text) from public,anon;
grant execute on function public.flow_dropoffs(uuid,text) to authenticated;

create or replace function public.flow_dropoff_page(p_tenant uuid,p_state text,p_seller uuid,p_reference bigint,p_older bigint,p_newer bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_older is not null and p_newer is not null then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(r.row order by r.sort) from (
 select jsonb_build_object('id',b.id,'seller_id',b.seller_id,'reference',b.reference,'processing_state',coalesce((select e.state from public.bag_processing_events e where e.tenant_id=p_tenant and e.bag_id=b.id order by e.version desc limit 1),'open'),'note',b.note,'received_at',b.received_at,'sellers',jsonb_build_object('name',s.name)) as row,
 case when p_newer is null then -b.reference else b.reference end as sort
 from public.flow_dropoffs(p_tenant,p_state) b join public.sellers s on s.tenant_id=b.tenant_id and s.id=b.seller_id
 where (p_seller is null or b.seller_id=p_seller) and (p_reference is null or b.reference=p_reference)
 and (p_older is null or b.reference<p_older) and (p_newer is null or b.reference>p_newer)
 order by 2 limit 21) r),'[]'::jsonb);
end $$;
revoke all on function public.flow_dropoff_page(uuid,text,uuid,bigint,bigint,bigint) from public,anon;
grant execute on function public.flow_dropoff_page(uuid,text,uuid,bigint,bigint,bigint) to authenticated;
