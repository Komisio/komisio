-- Identity and access platform. Business tables remain in experiments.
alter table tenants alter column created_by set not null;
alter table tenants add constraint tenants_creator_fk foreign key(created_by) references auth.users(id) on delete restrict;
alter table tenants add column creation_request_id uuid;
create unique index tenants_creation_request on tenants(created_by,creation_request_id);
alter table tenant_members add constraint tenant_members_user_fk foreign key(user_id) references auth.users(id) on delete restrict;
alter table tenant_members drop constraint tenant_members_role_check;
alter table tenant_members add constraint tenant_members_role_check check(role in ('owner','admin','staff','readonly'));

create table user_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=100),
 locale text not null default 'sv' check(locale in ('sv','en')),
 active_tenant_id uuid references tenants(id) on delete set null
);
create table tenant_invitations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete cascade,
 email text not null check(email=lower(trim(email)) and length(email)<=254),
 role text not null check(role in ('admin','staff','readonly')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_by uuid references auth.users(id) on delete restrict
);
create unique index one_pending_invitation on tenant_invitations(tenant_id,email) where status='pending';
create table access_events (
 id bigint generated always as identity primary key,
 tenant_id uuid not null references tenants(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 action text not null,
 target_id uuid,
 detail jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now()
);
create index access_events_tenant_date on access_events(tenant_id,occurred_at desc);

alter table user_profiles enable row level security;
alter table user_profiles force row level security;
alter table tenant_invitations enable row level security;
alter table tenant_invitations force row level security;
alter table access_events enable row level security;
alter table access_events force row level security;
create policy profile_read on user_profiles for select to authenticated using(user_id=auth.uid());
create policy invitations_read on tenant_invitations for select to authenticated using(tenant_role(tenant_id) in ('owner','admin'));
create policy events_read on access_events for select to authenticated using(tenant_role(tenant_id) in ('owner','admin'));
revoke all on user_profiles,tenant_invitations,access_events from anon,authenticated;
grant select on user_profiles,access_events to authenticated;
grant select(id,tenant_id,email,role,status,created_by,created_at,expires_at) on tenant_invitations to authenticated;
-- All membership changes now pass through the role-aware functions below.
revoke insert(tenant_id,user_id,role,invited_by),update(role),delete on tenant_members from authenticated;
revoke insert(slug,name,created_by),update(name) on tenants from authenticated;

create schema if not exists komisio_private;
revoke all on schema komisio_private from public,anon,authenticated;
create function komisio_private.require_identity() returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
  raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 return uid;
end $$;
create function komisio_private.record_access(p_tenant uuid,p_action text,p_target uuid default null,p_detail jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
 insert into public.access_events(tenant_id,actor_id,action,target_id,detail)
 values(p_tenant,auth.uid(),p_action,p_target,p_detail);
$$;

create or replace function tenant_members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 -- The tenant row serializes all membership changes, including owner removals.
 perform 1 from tenants where id=old.tenant_id for update;
 if old.role='owner' and (tg_op='DELETE' or new.role<>'owner') then
  if (select count(*) from tenant_members where tenant_id=old.tenant_id and role='owner')<=1 then
   raise exception 'komisio: cannot remove the last owner';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

create function create_tenant(p_name text,p_slug text,p_request_id uuid) returns uuid
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
 end if;
 insert into public.user_profiles(user_id,active_tenant_id) values(uid,tid)
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
 return tid;
end $$;

create function set_active_tenant(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=uid) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 insert into public.user_profiles(user_id,active_tenant_id) values(uid,p_tenant)
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
end $$;
create function save_profile(p_name text,p_locale text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if p_name is null or length(trim(p_name))>100 or p_locale is null or p_locale not in ('sv','en') then raise exception 'INVALID_INPUT'; end if;
 insert into public.user_profiles(user_id,display_name,locale) values(uid,trim(p_name),p_locale)
 on conflict(user_id) do update set display_name=excluded.display_name,locale=excluded.locale;
end $$;
create function rename_tenant(p_tenant uuid,p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
 update public.tenants set name=trim(p_name) where id=p_tenant;
 perform komisio_private.record_access(p_tenant,'tenant.renamed',p_tenant);
end $$;

create function list_members(p_tenant uuid) returns table(user_id uuid,display_name text,email text,role text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
 perform komisio_private.require_identity();
 actor_role:=public.tenant_role(p_tenant);
 if actor_role is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return query select m.user_id,coalesce(nullif(p.display_name,''),split_part(u.email,'@',1)),
 case when actor_role in ('owner','admin') or m.user_id=auth.uid() then u.email else null end,
 m.role,m.created_at
 from public.tenant_members m join auth.users u on u.id=m.user_id
 left join public.user_profiles p on p.user_id=m.user_id where m.tenant_id=p_tenant order by m.created_at;
end $$;

create function create_invitation(p_tenant uuid,p_email text,p_role text,p_token_hash text) returns uuid
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
 insert into public.tenant_invitations(tenant_id,email,role,token_hash,created_by) values(p_tenant,address,p_role,p_token_hash) returning id into iid;
 perform komisio_private.record_access(p_tenant,'invitation.created',iid,jsonb_build_object('role',p_role));
 return iid;
end $$;
create function revoke_invitation(p_tenant uuid,p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor_role text; invitation public.tenant_invitations%rowtype;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 actor_role:=public.tenant_role(p_tenant);
 select * into invitation from public.tenant_invitations where id=p_invitation and tenant_id=p_tenant;
 if coalesce(actor_role,'') not in ('owner','admin') or (actor_role='admin' and invitation.role='admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not found or invitation.status<>'pending' then raise exception 'INVITATION_INVALID'; end if;
 update public.tenant_invitations set status='revoked' where id=p_invitation;
 perform komisio_private.record_access(p_tenant,'invitation.revoked',p_invitation);
end $$;
create function accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity(); invitation public.tenant_invitations%rowtype; tid uuid; address text;
begin
 select tenant_id into tid from public.tenant_invitations where token_hash=p_token_hash;
 perform 1 from public.tenants where id=tid for update;
 select * into invitation from public.tenant_invitations where token_hash=p_token_hash for update;
 select lower(email) into address from auth.users where id=uid;
 if invitation.id is null or invitation.status<>'pending' or invitation.expires_at<=now() or invitation.email<>address then raise exception 'INVITATION_INVALID'; end if;
 -- Revocation of the inviter's administrative authority invalidates outstanding invitations.
 if coalesce(public.tenant_role_for_user(tid,invitation.created_by),'') not in ('owner','admin') then raise exception 'INVITATION_INVALID'; end if;
 if invitation.role='admin' and public.tenant_role_for_user(tid,invitation.created_by)<>'owner' then raise exception 'INVITATION_INVALID'; end if;
 insert into public.tenant_members(tenant_id,user_id,role,invited_by) values(tid,uid,invitation.role,invitation.created_by)
 on conflict(tenant_id,user_id) do nothing;
 update public.tenant_invitations set status='accepted',accepted_by=uid where id=invitation.id;
 insert into public.user_profiles(user_id,active_tenant_id) values(uid,tid)
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
 perform komisio_private.record_access(tid,'invitation.accepted',uid);
 return tid;
end $$;
-- Internal lookup is not exposed as an API callable helper.
create function tenant_role_for_user(p_tenant uuid,p_user uuid) returns text
language sql security definer set search_path = '' as $$
 select role from public.tenant_members where tenant_id=p_tenant and user_id=p_user;
$$;

create function change_member(p_tenant uuid,p_user uuid,p_role text) returns void
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
 if p_role is not null and p_role not in ('owner','admin','staff','readonly') then raise exception 'INVALID_INPUT'; end if;
 if p_role is null then delete from public.tenant_members where tenant_id=p_tenant and user_id=p_user;
 else update public.tenant_members set role=p_role where tenant_id=p_tenant and user_id=p_user; end if;
 perform komisio_private.record_access(p_tenant,case when p_role is null then 'member.removed' else 'member.role_changed' end,p_user,jsonb_build_object('from',target_role,'to',p_role));
end $$;

revoke all on all functions in schema komisio_private from public,anon,authenticated;
revoke all on function tenant_role_for_user(uuid,uuid) from public,anon,authenticated;
revoke all on function create_tenant(text,text,uuid),set_active_tenant(uuid),save_profile(text,text),rename_tenant(uuid,text),
 list_members(uuid),create_invitation(uuid,text,text,text),revoke_invitation(uuid,uuid),accept_invitation(text),change_member(uuid,uuid,text) from public,anon;
grant execute on function create_tenant(text,text,uuid),set_active_tenant(uuid),save_profile(text,text),rename_tenant(uuid,text),
 list_members(uuid),create_invitation(uuid,text,text,text),revoke_invitation(uuid,uuid),accept_invitation(text),change_member(uuid,uuid,text) to authenticated;
