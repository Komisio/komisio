-- P3 Fortnox connection: one connected Fortnox company per store, tokens
-- stored as ciphertext the application encrypts with a server-side key the
-- database never sees. The connection is bound to the Fortnox company
-- database (DatabaseNumber) and name, so a token for any other company is
-- refused before it is stored. Owner or admin connects, checks and
-- disconnects; every step is an append-only event. No voucher is sent by
-- this migration.
create table public.fortnox_connections (
 tenant_id uuid primary key references public.tenants(id),
 database_number text not null check(length(database_number) between 1 and 40),
 company_name text not null check(length(company_name) between 1 and 200),
 organisation_number text not null default '' check(length(organisation_number)<=40),
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data']),
 scope text not null default '' check(length(scope)<=500),
 expires_at timestamptz not null,
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now(),
 refreshed_at timestamptz not null default now()
);
create table public.fortnox_connection_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('connected','refreshed','checked','refused','disconnected')),
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index fortnox_connection_events_tenant on public.fortnox_connection_events(tenant_id,occurred_at desc);
alter table public.fortnox_connections enable row level security;
alter table public.fortnox_connection_events enable row level security;
revoke all on public.fortnox_connections,public.fortnox_connection_events from public,anon,authenticated;
-- The ciphertext row is never selectable directly (no grant); the policy states who could ever read it.
grant select on public.fortnox_connection_events to authenticated;
create policy fortnox_connections_owner on public.fortnox_connections for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create policy fortnox_events_read on public.fortnox_connection_events for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger fortnox_connection_events_immutable before update or delete on public.fortnox_connection_events for each row execute function komisio_private.preserve_payout_event();
create function komisio_private.guard_fortnox_connection() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('komisio.fortnox_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_CONNECTION' using errcode='55000'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_fortnox_connection() from public,anon,authenticated;
create trigger fortnox_connections_guard before update or delete on public.fortnox_connections for each row execute function komisio_private.guard_fortnox_connection();

create function komisio_private.fortnox_event(p_tenant uuid,p_kind text,p_detail jsonb,p_actor uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.fortnox_connection_events(tenant_id,kind,detail,actor) values(p_tenant,p_kind,coalesce(p_detail,'{}'::jsonb),p_actor);
$$;
revoke all on function komisio_private.fortnox_event(uuid,text,jsonb,uuid) from public,anon,authenticated;

-- Store or replace the store's connection after the application verified the company.
create function public.store_fortnox_connection(p_tenant uuid,p_database_number text,p_company_name text,p_organisation_number text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.fortnox_connections; replacing boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_database_number is null or length(trim(p_database_number)) not between 1 and 40 or p_company_name is null or length(trim(p_company_name)) not between 1 and 200
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.fortnox_connections where tenant_id=p_tenant;
 replacing:=found;
 if replacing and existing.database_number<>trim(p_database_number) then raise exception 'FORTNOX_WRONG_COMPANY'; end if;
 perform set_config('komisio.fortnox_transition','engine',true);
 if replacing then
  update public.fortnox_connections set company_name=trim(p_company_name),organisation_number=coalesce(trim(p_organisation_number),''),cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=now() where tenant_id=p_tenant;
 else
  insert into public.fortnox_connections(tenant_id,database_number,company_name,organisation_number,cipher,scope,expires_at,connected_by)
  values(p_tenant,trim(p_database_number),trim(p_company_name),coalesce(trim(p_organisation_number),''),p_cipher,coalesce(p_scope,''),p_expires_at,uid);
 end if;
 perform set_config('komisio.fortnox_transition','',true);
 perform komisio_private.fortnox_event(p_tenant,case when replacing then 'refreshed' else 'connected' end,jsonb_build_object('database_number',trim(p_database_number),'company_name',trim(p_company_name)),uid);
 perform komisio_private.record_access(p_tenant,'fortnox.'||case when replacing then 'refreshed' else 'connected' end,p_tenant,jsonb_build_object('database_number',trim(p_database_number)));
 return jsonb_build_object('databaseNumber',trim(p_database_number),'companyName',trim(p_company_name),'replaced',replacing);
end $$;

-- The server reads the ciphertext to act for the store; owner or admin only.
create function public.read_fortnox_connection(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.fortnox_connections;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('databaseNumber',c.database_number,'companyName',c.company_name,'organisationNumber',c.organisation_number,'cipher',c.cipher,'scope',c.scope,'expiresAt',c.expires_at,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at);
end $$;

-- What any member may see: whether and to which company the store is connected, never the tokens.
create function public.fortnox_connection_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.fortnox_connections;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 return jsonb_build_object('connected',found,'databaseNumber',c.database_number,'companyName',c.company_name,'organisationNumber',c.organisation_number,'scope',c.scope,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at,
  'events',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'detail',e.detail,'occurredAt',e.occurred_at) order by e.occurred_at desc),'[]') from (select * from public.fortnox_connection_events where tenant_id=p_tenant order by occurred_at desc limit 20) e));
end $$;

create function public.record_fortnox_check(p_tenant uuid,p_kind text,p_detail jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('checked','refused') or p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.fortnox_event(p_tenant,p_kind,p_detail,uid);
end $$;

create function public.disconnect_fortnox(p_tenant uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.fortnox_connections;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then return false; end if;
 perform set_config('komisio.fortnox_transition','engine',true);
 delete from public.fortnox_connections where tenant_id=p_tenant;
 perform set_config('komisio.fortnox_transition','',true);
 perform komisio_private.fortnox_event(p_tenant,'disconnected',jsonb_build_object('database_number',c.database_number),uid);
 perform komisio_private.record_access(p_tenant,'fortnox.disconnected',p_tenant,jsonb_build_object('database_number',c.database_number));
 return true;
end $$;
revoke all on function public.store_fortnox_connection(uuid,text,text,text,jsonb,text,timestamptz),public.read_fortnox_connection(uuid),public.fortnox_connection_status(uuid),public.record_fortnox_check(uuid,text,jsonb),public.disconnect_fortnox(uuid) from public,anon;
grant execute on function public.store_fortnox_connection(uuid,text,text,text,jsonb,text,timestamptz),public.read_fortnox_connection(uuid),public.fortnox_connection_status(uuid),public.record_fortnox_check(uuid,text,jsonb),public.disconnect_fortnox(uuid) to authenticated;
