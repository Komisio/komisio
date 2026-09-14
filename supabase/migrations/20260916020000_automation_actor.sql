-- Automation actor (owner decision D1, 2026-09-14): a fifth tenant role,
-- `automation`, held only by the deployment's automation identity and only
-- for stores where an owner has enabled a named scope. The owner's grant
-- names the identity's e-mail (the server passes it from its configuration);
-- the identity accepts the grant itself, which is the only way an
-- `automation` membership comes to exist. Scopes are checked by the
-- functions the automation may call through komisio_private.automation_allowed.
alter table public.tenant_members drop constraint tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check check(role in ('owner','admin','staff','readonly','automation'));

create table public.automation_grants (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 scope text not null check(scope in ('zettle_pull','fortnox_send')),
 identity_email text not null check(identity_email=lower(identity_email) and identity_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(identity_email)<=254),
 enabled_by uuid not null references auth.users(id),
 enabled_at timestamptz not null default now(),
 accepted_by uuid references auth.users(id),
 accepted_at timestamptz,
 disabled_by uuid references auth.users(id),
 disabled_at timestamptz,
 check((accepted_by is null)=(accepted_at is null)),
 check((disabled_by is null)=(disabled_at is null))
);
create unique index automation_grants_active on public.automation_grants(tenant_id,scope) where disabled_at is null;
alter table public.automation_grants enable row level security;
revoke all on public.automation_grants from public,anon,authenticated;
grant select on public.automation_grants to authenticated;
create policy automation_grants_read on public.automation_grants for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));

-- Automation memberships change only through the functions below.
create function komisio_private.guard_automation_member() returns trigger
language plpgsql set search_path='' as $$
begin
 if (tg_op<>'INSERT' and old.role='automation') or (tg_op<>'DELETE' and new.role='automation') then
  if current_setting('komisio.automation_transition',true) is distinct from 'engine' then raise exception 'AUTOMATION_MEMBERSHIP' using errcode='55000'; end if;
  if tg_op='UPDATE' and old.role<>new.role then raise exception 'AUTOMATION_MEMBERSHIP' using errcode='55000'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_automation_member() from public,anon,authenticated;
create trigger tenant_members_automation before insert or update or delete on public.tenant_members for each row execute function komisio_private.guard_automation_member();

-- Grants: ordinary member administration never touches the automation role.
create or replace function public.change_member(p_tenant uuid,p_user uuid,p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 actor_role:=public.tenant_role(p_tenant);
 select role into target_role from public.tenant_members where tenant_id=p_tenant and user_id=p_user;
 if coalesce(actor_role,'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if actor_role='admin' and (target_role in ('owner','admin') or p_role in ('owner','admin')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if target_role is null then raise exception 'MEMBER_NOT_FOUND'; end if;
 if target_role='automation' then raise exception 'AUTOMATION_MEMBERSHIP'; end if;
 if p_role is not null and p_role not in ('owner','admin','staff','readonly') then raise exception 'INVALID_INPUT'; end if;
 if p_role is null then delete from public.tenant_members where tenant_id=p_tenant and user_id=p_user;
 else update public.tenant_members set role=p_role where tenant_id=p_tenant and user_id=p_user; end if;
 perform komisio_private.record_access(p_tenant,case when p_role is null then 'member.removed' else 'member.role_changed' end,p_user,jsonb_build_object('from',target_role,'to',p_role));
end $$;

create function public.enable_automation(p_tenant uuid,p_id uuid,p_scope text,p_identity_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.automation_grants; address text:=lower(trim(p_identity_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_scope not in ('zettle_pull','fortnox_send') or address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.automation_grants where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.scope<>p_scope or prior.enabled_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.automation_grant_state(prior);
 end if;
 if exists(select 1 from public.automation_grants where tenant_id=p_tenant and scope=p_scope and disabled_at is null) then raise exception 'AUTOMATION_ALREADY_ENABLED'; end if;
 insert into public.automation_grants(id,tenant_id,scope,identity_email,enabled_by) values(p_id,p_tenant,p_scope,address,uid) returning * into prior;
 perform komisio_private.record_access(p_tenant,'automation.enabled',p_id,jsonb_build_object('scope',p_scope));
 return komisio_private.automation_grant_state(prior);
end $$;

create function komisio_private.automation_grant_state(g public.automation_grants) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',g.id,'scope',g.scope,'enabledAt',g.enabled_at,'accepted',g.accepted_at is not null,'acceptedAt',g.accepted_at,'disabledAt',g.disabled_at);
$$;
revoke all on function komisio_private.automation_grant_state(public.automation_grants) from public,anon,authenticated;

-- The automation identity accepts every open grant addressed to its e-mail;
-- acceptance is what creates the membership.
create function public.accept_automation_grants() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); address text; g public.automation_grants; accepted jsonb:='[]'::jsonb;
begin
 select lower(email) into address from auth.users where id=uid;
 for g in select * from public.automation_grants where identity_email=address and accepted_at is null and disabled_at is null order by enabled_at for update loop
  perform 1 from public.tenants where id=g.tenant_id for update;
  if exists(select 1 from public.tenant_members where tenant_id=g.tenant_id and user_id=uid and role<>'automation') then raise exception 'AUTOMATION_IDENTITY_IS_MEMBER'; end if;
  perform set_config('komisio.automation_transition','engine',true);
  insert into public.tenant_members(tenant_id,user_id,role) values(g.tenant_id,uid,'automation') on conflict do nothing;
  perform set_config('komisio.automation_transition','',true);
  update public.automation_grants set accepted_by=uid,accepted_at=now() where id=g.id;
  perform komisio_private.record_access(g.tenant_id,'automation.accepted',g.id,jsonb_build_object('scope',g.scope));
  accepted:=accepted||jsonb_build_object('tenantId',g.tenant_id,'scope',g.scope);
 end loop;
 return accepted;
end $$;

create function public.disable_automation(p_tenant uuid,p_scope text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); g public.automation_grants;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into g from public.automation_grants where tenant_id=p_tenant and scope=p_scope and disabled_at is null;
 if not found then return false; end if;
 update public.automation_grants set disabled_by=uid,disabled_at=now() where id=g.id;
 if g.accepted_by is not null and not exists(select 1 from public.automation_grants where tenant_id=p_tenant and accepted_by=g.accepted_by and disabled_at is null) then
  perform set_config('komisio.automation_transition','engine',true);
  delete from public.tenant_members where tenant_id=p_tenant and user_id=g.accepted_by and role='automation';
  perform set_config('komisio.automation_transition','',true);
 end if;
 perform komisio_private.record_access(p_tenant,'automation.disabled',g.id,jsonb_build_object('scope',p_scope));
 return true;
end $$;

-- For the functions an automation may call: role automation plus an accepted, active grant for the scope.
create function komisio_private.automation_allowed(p_tenant uuid,p_scope text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.tenant_role(p_tenant)='automation' and exists(
  select 1 from public.automation_grants g where g.tenant_id=p_tenant and g.scope=p_scope and g.accepted_by=auth.uid() and g.disabled_at is null);
$$;
revoke all on function komisio_private.automation_allowed(uuid,text) from public,anon,authenticated;

create function public.automation_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(komisio_private.automation_grant_state(g) order by g.enabled_at desc) from public.automation_grants g where g.tenant_id=p_tenant and g.disabled_at is null),'[]'::jsonb);
end $$;
revoke all on function public.enable_automation(uuid,uuid,text,text),public.accept_automation_grants(),public.disable_automation(uuid,text),public.automation_status(uuid) from public,anon;
grant execute on function public.enable_automation(uuid,uuid,text,text),public.accept_automation_grants(),public.disable_automation(uuid,text),public.automation_status(uuid) to authenticated;
