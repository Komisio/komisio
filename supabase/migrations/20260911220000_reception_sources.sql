-- Reception preparation, not custody, financial acceptance or seller consent.
create table public.reception_sessions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id)
);
create index reception_sessions_tenant on public.reception_sessions(tenant_id,created_at desc,id);

-- Only staff-entered textual evidence is supported until protected capture ships.
create function komisio_private.valid_reception_sources(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare source jsonb; seen uuid[]:='{}'; sid uuid;
begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 if jsonb_array_length(value) not between 1 and 20 then return false; end if;
 for source in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(source)<>'object' then return false; end if;
  if not(source ?& array['id','kind','reference','observation']) or (source-array['id','kind','reference','observation'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(source->'id')<>'string' or jsonb_typeof(source->'kind')<>'string'
   or jsonb_typeof(source->'reference')<>'string' or jsonb_typeof(source->'observation')<>'string' then return false; end if;
  if (source->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  sid:=(source->>'id')::uuid;
  if sid=any(seen) then return false; end if;
  seen:=array_append(seen,sid);
  if source->>'kind' not in ('observation','price-evidence')
   or length(trim(source->>'reference')) not between 1 and 500
   or length(source->>'reference')>500 or length(source->>'observation')>2000 then return false; end if;
 end loop;
 return true;
end $$;

create table public.reception_source_revisions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 session_id uuid not null,
 revision integer not null check(revision>0),
 sources jsonb not null check(komisio_private.valid_reception_sources(sources)),
 created_by uuid not null references auth.users(id),
 saved_at timestamptz not null default now(),
 unique(session_id,revision),
 foreign key(tenant_id,session_id) references public.reception_sessions(tenant_id,id)
);
create index reception_sources_session on public.reception_source_revisions(tenant_id,session_id,revision desc);
alter table public.reception_sessions enable row level security;
alter table public.reception_source_revisions enable row level security;
create policy reception_sessions_read on public.reception_sessions for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy reception_sources_read on public.reception_source_revisions for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.reception_sessions,public.reception_source_revisions from public,anon,authenticated;
grant select on public.reception_sessions,public.reception_source_revisions to authenticated;
create function komisio_private.preserve_reception() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_RECEPTION'; end $$;
create trigger reception_identity_immutable before update or delete on public.reception_sessions for each row execute function komisio_private.preserve_reception();
create trigger reception_sources_immutable before update or delete on public.reception_source_revisions for each row execute function komisio_private.preserve_reception();
create view public.reception_sources_current with(security_invoker=true) as
 select distinct on(session_id) * from public.reception_source_revisions order by session_id,revision desc;
revoke all on public.reception_sources_current from public,anon,authenticated;
grant select on public.reception_sources_current to authenticated;

create function public.create_reception_session(p_tenant uuid,p_id uuid,p_seller uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.reception_sessions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.reception_sessions where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.seller_id is distinct from p_seller or previous.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.sellers where id=p_seller and tenant_id=p_tenant) then raise exception 'SELLER_NOT_FOUND'; end if;
 insert into public.reception_sessions(id,tenant_id,seller_id,created_by) values(p_id,p_tenant,p_seller,uid);
 perform komisio_private.record_access(p_tenant,'reception.created',p_id,'{}'::jsonb);
 return p_id;
end $$;

create function public.save_reception_sources(p_tenant uuid,p_request uuid,p_session uuid,p_expected integer,p_sources jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.reception_source_revisions; latest integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_expected is null or p_expected<0 or p_expected>=2147483647
  or not komisio_private.valid_reception_sources(p_sources) then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.reception_source_revisions where id=p_request;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.session_id is distinct from p_session or previous.created_by is distinct from uid
   or previous.revision is distinct from p_expected+1 or previous.sources is distinct from p_sources then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if not exists(select 1 from public.reception_sessions where id=p_session and tenant_id=p_tenant) then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select revision into latest from public.reception_source_revisions where session_id=p_session order by revision desc limit 1;
 if coalesce(latest,0)<>p_expected then raise exception 'RECEPTION_CHANGED'; end if;
 if exists(select 1 from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) old_source
  cross join jsonb_array_elements(p_sources) new_source
  where r.session_id=p_session and old_source->>'id'=new_source->>'id' and old_source<>new_source) then raise exception 'RECEPTION_SOURCE_CHANGED'; end if;
 insert into public.reception_source_revisions(id,tenant_id,session_id,revision,sources,created_by)
 values(p_request,p_tenant,p_session,p_expected+1,p_sources,uid);
 perform komisio_private.record_access(p_tenant,'reception.sources_saved',p_session,jsonb_build_object('revision',p_expected+1));
 return p_request;
end $$;
revoke all on function public.create_reception_session(uuid,uuid,uuid),public.save_reception_sources(uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.create_reception_session(uuid,uuid,uuid),public.save_reception_sources(uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on function komisio_private.valid_reception_sources(jsonb) from public,anon,authenticated;
