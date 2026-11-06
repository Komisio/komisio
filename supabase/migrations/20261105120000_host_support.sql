-- #777: real-identity, session-bound support; no membership or impersonation.
create table komisio_private.host_support_visits (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 auth_session_id uuid not null,
 tenant_id uuid not null references public.tenants(id),
 reason text not null check(length(trim(reason)) between 1 and 500),
 started_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null,
 check(expires_at=started_at+interval '60 minutes')
);
create index host_support_actor_session on komisio_private.host_support_visits(user_id,auth_session_id);
create table komisio_private.host_support_ends (
 visit_id uuid primary key references komisio_private.host_support_visits(id),
 ended_by uuid not null references auth.users(id),
 ended_at timestamptz not null default statement_timestamp()
);
revoke all on komisio_private.host_support_visits,komisio_private.host_support_ends from public,anon,authenticated;
alter table komisio_private.host_support_visits enable row level security;
alter table komisio_private.host_support_ends enable row level security;

create function komisio_private.support_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE' using errcode='55000'; end $$;
create trigger immutable before update or delete on komisio_private.host_support_visits
 for each row execute function komisio_private.support_immutable();
create trigger immutable before update or delete on komisio_private.host_support_ends
 for each row execute function komisio_private.support_immutable();

-- Deliberately includes expired and revoked visits: only explicit exit restores
-- ordinary privileges. A signed Auth session identifier is not an application flag.
create function komisio_private.current_support_visit() returns setof komisio_private.host_support_visits
language sql stable security definer set search_path='' as $$
 select v.* from komisio_private.host_support_visits v
 where v.user_id=auth.uid() and v.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid
 and not exists(select 1 from komisio_private.host_support_ends e where e.visit_id=v.id)
 order by v.started_at desc,v.id limit 1;
$$;
create function komisio_private.support_lock_key() returns bigint
language sql stable set search_path='' as $$
 select hashtextextended('host-support:'||auth.uid()::text||':'||(auth.jwt()->>'session_id'),0);
$$;
create function komisio_private.support_session_verified() returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_platform_host() and exists(select 1 from auth.sessions s
  where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid()
  and (s.not_after is null or s.not_after>statement_timestamp()));
$$;

create or replace function public.tenant_role(p_tenant uuid) returns text
language sql stable security definer set search_path='' as $$
 with support as (select * from komisio_private.current_support_visit())
 select case when exists(select 1 from support) then
   (select 'readonly'::text from support where tenant_id=p_tenant
    and expires_at>statement_timestamp() and komisio_private.support_session_verified())
 else (select role from public.tenant_members where tenant_id=p_tenant
    and user_id=auth.uid() and public.verified_session()) end;
$$;
create or replace function public.user_tenant_ids() returns setof uuid
language sql stable security definer set search_path='' as $$
 with support as (select * from komisio_private.current_support_visit())
 select tenant_id from support where expires_at>statement_timestamp() and komisio_private.support_session_verified()
 union all
 select tenant_id from public.tenant_members where user_id=auth.uid() and role<>'device'
 and public.verified_session() and not exists(select 1 from support);
$$;

-- A second boundary catches writes that do not require a tenant role (including
-- host plan actions, personal preferences and old forms). Shared transaction locks
-- let ordinary writes run concurrently but serialize start/end against a write.
create function komisio_private.guard_support_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare lock_key bigint:=komisio_private.support_lock_key();
begin
 if lock_key is not null then
  perform pg_advisory_xact_lock_shared(lock_key);
  if exists(select 1 from komisio_private.current_support_visit()) then
   raise exception 'SUPPORT_READ_ONLY' using errcode='42501';
  end if;
 end if;
 return null;
end $$;
-- Future business tables must install the same statement trigger; pgTAP checks
-- coverage. Auth-owned login/session tables remain under Supabase Auth's control.
do $$ declare target record; begin
 for target in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and (n.nspname in ('public','komisio_private') or (n.nspname='storage' and c.relname='objects'))
  and c.relname not in ('host_support_visits','host_support_ends','spatial_ref_sys')
  and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
 loop
  execute format('create trigger support_read_only_guard before insert or update or delete or truncate on %I.%I for each statement execute function komisio_private.guard_support_write()',target.nspname,target.relname);
 end loop;
end $$;

create function public.host_support_context() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',v.id,'reason',v.reason,'startedAt',v.started_at,'expiresAt',v.expires_at,'serverNow',statement_timestamp(),
  'available',v.expires_at>statement_timestamp() and komisio_private.support_session_verified(),
  'tenant',jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'role','readonly'))
 from komisio_private.current_support_visit() v join public.tenants t on t.id=v.tenant_id;
$$;

create function public.start_host_support(p_id uuid,p_tenant uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
 existing komisio_private.host_support_visits; started timestamptz:=statement_timestamp();
begin
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if sid is null or not komisio_private.support_session_verified() then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_id is null or p_tenant is null or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(komisio_private.support_lock_key());
 select * into existing from komisio_private.host_support_visits where id=p_id;
 if found then
  if existing.user_id<>uid or existing.auth_session_id<>sid or existing.tenant_id<>p_tenant or existing.reason<>trim(p_reason) then
   raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if exists(select 1 from komisio_private.host_support_ends where visit_id=p_id) then raise exception 'SUPPORT_ENDED'; end if;
  return public.host_support_context();
 end if;
 if exists(select 1 from komisio_private.current_support_visit()) then raise exception 'SUPPORT_ACTIVE'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'TENANT_NOT_FOUND'; end if;
 insert into komisio_private.host_support_visits(id,user_id,auth_session_id,tenant_id,reason,started_at,expires_at)
 values(p_id,uid,sid,p_tenant,trim(p_reason),started,started+interval '60 minutes');
 return public.host_support_context();
end $$;

create function public.end_host_support(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 perform pg_advisory_xact_lock(komisio_private.support_lock_key());
 if not exists(select 1 from komisio_private.host_support_visits where id=p_id and user_id=uid
  and auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid) then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 insert into komisio_private.host_support_ends(visit_id,ended_by) values(p_id,uid) on conflict do nothing;
end $$;

revoke all on function komisio_private.support_immutable(),komisio_private.current_support_visit(),komisio_private.support_lock_key(),komisio_private.support_session_verified(),komisio_private.guard_support_write() from public,anon,authenticated;
revoke all on function public.host_support_context(),public.start_host_support(uuid,uuid,text),public.end_host_support(uuid) from public,anon;
grant execute on function public.host_support_context(),public.start_host_support(uuid,uuid,text),public.end_host_support(uuid) to authenticated;
