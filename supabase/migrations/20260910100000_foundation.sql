-- Komisio — phase 0 foundation: tenants and membership
--
-- The only schema that exists in phase 0. Decisions in DECISIONS.md
-- (2026-09-10): membership is the only source of access; membership
-- administration is owner-only; a tenant always keeps at least one owner.

create extension if not exists pgcrypto;

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text not null,
  created_by  uuid,                                  -- auth.users(id); becomes the first owner
  created_at  timestamptz not null default now()
);

create table tenant_members (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null,                         -- auth.users(id)
  role        text not null check (role in ('owner', 'staff', 'readonly')),
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Request context
-- ---------------------------------------------------------------------------

create or replace function jwt_claims()
returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function current_user_id()
returns uuid language sql stable
as $$ select nullif(jwt_claims() ->> 'sub', '')::uuid $$;

-- Membership lookup. SECURITY DEFINER so it can read tenant_members without
-- recursing into that table's own policies.
create or replace function user_tenant_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$ select tenant_id from tenant_members where user_id = current_user_id() $$;

create or replace function tenant_role(p_tenant uuid)
returns text language sql stable security definer set search_path = public
as $$ select role from tenant_members where tenant_id = p_tenant and user_id = current_user_id() $$;

create or replace function is_owner(p_tenant uuid)
returns boolean language sql stable
as $$ select coalesce(tenant_role(p_tenant), '') = 'owner' $$;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- The creator becomes the first owner. SECURITY DEFINER because the creator
-- is not yet a member when the membership policy would be evaluated.
create or replace function tenants_after_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into tenant_members (tenant_id, user_id, role) values (new.id, new.created_by, 'owner');
  end if;
  return new;
end;
$$;

create trigger tenants_after_insert after insert on tenants
  for each row execute function tenants_after_insert();

-- A tenant always keeps at least one owner.
create or replace function tenant_members_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if (select count(*) from tenant_members where tenant_id = old.tenant_id and role = 'owner') <= 1 then
      raise exception 'komisio: cannot remove the last owner of tenant %', old.tenant_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger tenant_members_guard before update or delete on tenant_members
  for each row execute function tenant_members_guard();

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;

alter table tenants enable row level security;
alter table tenants force row level security;
alter table tenant_members enable row level security;
alter table tenant_members force row level security;

create policy tenants_select on tenants for select using (id in (select user_tenant_ids()));
create policy tenants_insert on tenants for insert with check (created_by = current_user_id());
create policy tenants_update on tenants for update using (is_owner(id)) with check (is_owner(id));

create policy tenant_members_select on tenant_members for select using (tenant_id in (select user_tenant_ids()));
create policy tenant_members_insert on tenant_members for insert with check (is_owner(tenant_id));
create policy tenant_members_update on tenant_members for update using (is_owner(tenant_id)) with check (is_owner(tenant_id));
create policy tenant_members_delete on tenant_members for delete using (is_owner(tenant_id));

-- Supabase grants ALL on new public tables to anon/authenticated by default
-- privilege — revoke, then grant exactly what is allowed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
grant usage on schema public to authenticated;

grant select on tenants, tenant_members to authenticated;
grant insert (slug, name, created_by) on tenants to authenticated;
grant update (name) on tenants to authenticated;
grant insert (tenant_id, user_id, role, invited_by) on tenant_members to authenticated;
grant update (role) on tenant_members to authenticated;
grant delete on tenant_members to authenticated;

grant execute on function
  jwt_claims(), current_user_id(), user_tenant_ids(), tenant_role(uuid), is_owner(uuid),
  tenants_after_insert(), tenant_members_guard()
to authenticated;
