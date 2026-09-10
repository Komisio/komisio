-- A creation retry must not reactivate a store after membership removal.
create or replace function create_tenant(p_name text,p_slug text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity(); tid uuid;
begin
 if length(trim(p_name)) not between 1 and 100 or p_name is null or p_request_id is null
 or p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 select id into tid from public.tenants where created_by=uid and creation_request_id=p_request_id;
 if tid is null then
  insert into public.tenants(name,slug,created_by,creation_request_id) values(trim(p_name),p_slug,uid,p_request_id) returning id into tid;
  perform komisio_private.record_access(tid,'tenant.created',tid);
 else
  perform 1 from public.tenants where id=tid for update;
  if not exists(select 1 from public.tenant_members where tenant_id=tid and user_id=uid) then
   raise exception 'FORBIDDEN' using errcode='42501';
  end if;
 end if;
 insert into public.user_profiles(user_id,active_tenant_id) values(uid,tid)
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
 return tid;
end $$;

