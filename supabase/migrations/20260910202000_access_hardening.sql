create or replace function create_invitation(p_tenant uuid,p_email text,p_role text,p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity(); actor_role text; iid uuid; address text:=lower(trim(p_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 actor_role:=public.tenant_role(p_tenant);
 if coalesce(actor_role,'') not in ('owner','admin') or (actor_role='admin' and p_role='admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254
 or p_role is null or p_role not in ('admin','staff','readonly') or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=p_tenant and lower(u.email)=address) then raise exception 'ALREADY_MEMBER'; end if;
 update public.tenant_invitations set status='revoked' where tenant_id=p_tenant and email=address and status='pending';
 insert into public.tenant_invitations(tenant_id,email,role,token_hash,created_by) values(p_tenant,address,p_role,p_token_hash,uid) returning id into iid;
 perform komisio_private.record_access(p_tenant,'invitation.created',iid,jsonb_build_object('role',p_role));
 return iid;
end $$;

-- Every verified MFA factor requires aal2, including direct database API access.
create function public.verified_session() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 and (not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
      or coalesce(auth.jwt()->>'aal','')='aal2');
$$;
revoke all on function public.verified_session() from public,anon;
grant execute on function public.verified_session() to authenticated;
create or replace function komisio_private.require_identity() returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not public.verified_session() then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return auth.uid();
end $$;
create or replace function user_tenant_ids() returns setof uuid
language sql stable security definer set search_path='' as $$
 select tenant_id from public.tenant_members where user_id=auth.uid() and public.verified_session();
$$;
create or replace function tenant_role(p_tenant uuid) returns text
language sql stable security definer set search_path='' as $$
 select role from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid() and public.verified_session();
$$;
alter policy profile_read on user_profiles using(user_id=auth.uid() and public.verified_session());


