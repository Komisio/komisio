-- P3 Shopify connection (docs/SHOPIFY-ADAPTER.md, step 1): one connected
-- Shopify shop per store, tokens stored as ciphertext the application
-- encrypts with a server-side key the database never sees. The connection is
-- bound to the shop's myshopify domain, so a token for any other shop is
-- refused before it is stored. Owner or admin connects, checks and
-- disconnects; every step is an append-only event. Nothing is exported or
-- imported by this migration. Mirrors the Fortnox connection.
create table public.shopify_connections (
 tenant_id uuid primary key references public.tenants(id),
 shop_domain text not null check(shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' and length(shop_domain)<=120),
 shop_name text not null check(length(shop_name) between 1 and 200),
 currency text not null check(length(currency)=3),
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data']),
 scope text not null default '' check(length(scope)<=500),
 expires_at timestamptz,
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now(),
 refreshed_at timestamptz not null default now(),
 revision bigint not null default nextval('komisio_private.fortnox_connection_revision')
);
create table public.shopify_connection_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('connected','refreshed','checked','refused','disconnected')),
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index shopify_connection_events_tenant on public.shopify_connection_events(tenant_id,occurred_at desc);
alter table public.shopify_connections enable row level security;
alter table public.shopify_connection_events enable row level security;
revoke all on public.shopify_connections,public.shopify_connection_events from public,anon,authenticated;
grant select on public.shopify_connection_events to authenticated;
create policy shopify_connections_owner on public.shopify_connections for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create policy shopify_events_read on public.shopify_connection_events for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger shopify_connection_events_immutable before update or delete on public.shopify_connection_events for each row execute function komisio_private.preserve_payout_event();
create function komisio_private.guard_shopify_connection() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('komisio.shopify_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_CONNECTION' using errcode='55000'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_shopify_connection() from public,anon,authenticated;
create trigger shopify_connections_guard before update or delete on public.shopify_connections for each row execute function komisio_private.guard_shopify_connection();

create function komisio_private.shopify_event(p_tenant uuid,p_kind text,p_detail jsonb,p_actor uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.shopify_connection_events(tenant_id,kind,detail,actor) values(p_tenant,p_kind,coalesce(p_detail,'{}'::jsonb),p_actor);
$$;
revoke all on function komisio_private.shopify_event(uuid,text,jsonb,uuid) from public,anon,authenticated;

-- Store or replace the store's connection after the application verified the shop.
create function public.store_shopify_connection(p_tenant uuid,p_shop_domain text,p_shop_name text,p_currency text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.shopify_connections; replacing boolean; host text:=lower(trim(coalesce(p_shop_domain,'')));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if host !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or length(host)>120 or p_shop_name is null or length(trim(p_shop_name)) not between 1 and 200
  or p_currency is null or length(p_currency)<>3
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or (p_expires_at is not null and not isfinite(p_expires_at)) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.shopify_connections where tenant_id=p_tenant;
 replacing:=found;
 if replacing and existing.shop_domain<>host then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 perform set_config('komisio.shopify_transition','engine',true);
 if replacing then
  update public.shopify_connections set shop_name=trim(p_shop_name),currency=upper(p_currency),cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=now(),revision=nextval('komisio_private.fortnox_connection_revision') where tenant_id=p_tenant;
 else
  insert into public.shopify_connections(tenant_id,shop_domain,shop_name,currency,cipher,scope,expires_at,connected_by)
  values(p_tenant,host,trim(p_shop_name),upper(p_currency),p_cipher,coalesce(p_scope,''),p_expires_at,uid);
 end if;
 perform set_config('komisio.shopify_transition','',true);
 perform komisio_private.shopify_event(p_tenant,case when replacing then 'refreshed' else 'connected' end,jsonb_build_object('shop_domain',host,'shop_name',trim(p_shop_name)),uid);
 perform komisio_private.record_access(p_tenant,'shopify.'||case when replacing then 'refreshed' else 'connected' end,p_tenant,jsonb_build_object('shop_domain',host));
 return jsonb_build_object('shopDomain',host,'shopName',trim(p_shop_name),'replaced',replacing);
end $$;

-- The server reads the ciphertext to act for the store; owner or admin only.
create function public.read_shopify_connection(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.shopify_connections;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.shopify_connections where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('shopDomain',c.shop_domain,'shopName',c.shop_name,'currency',c.currency,'cipher',c.cipher,'scope',c.scope,'expiresAt',c.expires_at,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at,'revision',c.revision::text);
end $$;

-- What any member may see: whether and to which shop the store is connected, never the tokens.
create function public.shopify_connection_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.shopify_connections;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.shopify_connections where tenant_id=p_tenant;
 return jsonb_build_object('connected',found,'shopDomain',c.shop_domain,'shopName',c.shop_name,'currency',c.currency,'scope',c.scope,'expiresAt',c.expires_at,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at,
  'events',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'detail',e.detail,'occurredAt',e.occurred_at) order by e.occurred_at desc),'[]') from (select * from public.shopify_connection_events where tenant_id=p_tenant order by occurred_at desc limit 20) e));
end $$;

create function public.record_shopify_check(p_tenant uuid,p_kind text,p_detail jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('checked','refused') or p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.shopify_event(p_tenant,p_kind,p_detail,uid);
end $$;

create function public.disconnect_shopify(p_tenant uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.shopify_connections;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.shopify_connections where tenant_id=p_tenant;
 if not found then return false; end if;
 perform set_config('komisio.shopify_transition','engine',true);
 delete from public.shopify_connections where tenant_id=p_tenant;
 perform set_config('komisio.shopify_transition','',true);
 perform komisio_private.shopify_event(p_tenant,'disconnected',jsonb_build_object('shop_domain',c.shop_domain),uid);
 perform komisio_private.record_access(p_tenant,'shopify.disconnected',p_tenant,jsonb_build_object('shop_domain',c.shop_domain));
 return true;
end $$;
revoke all on function public.store_shopify_connection(uuid,text,text,text,jsonb,text,timestamptz),public.read_shopify_connection(uuid),public.shopify_connection_status(uuid),public.record_shopify_check(uuid,text,jsonb),public.disconnect_shopify(uuid) from public,anon;
grant execute on function public.store_shopify_connection(uuid,text,text,text,jsonb,text,timestamptz),public.read_shopify_connection(uuid),public.shopify_connection_status(uuid),public.record_shopify_check(uuid,text,jsonb),public.disconnect_shopify(uuid) to authenticated;
