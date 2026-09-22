-- Provider credentials are operational data. Access events remain immutable.
create table public.paypal_credentials (
 tenant_id uuid primary key references public.tenants(id),
 merchant_id uuid not null,
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data']),
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now()
);
alter table public.paypal_credentials enable row level security;
revoke all on public.paypal_credentials from public,anon,authenticated;

create function public.store_paypal_credentials(p_tenant uuid,p_merchant uuid,p_cipher jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_merchant is null or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or octet_length(p_cipher::text)>65536 then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.paypal_credentials where tenant_id=p_tenant and merchant_id<>p_merchant)
 or exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id<>p_merchant)
 then raise exception 'ZETTLE_WRONG_MERCHANT'; end if;
 insert into public.paypal_credentials(tenant_id,merchant_id,cipher,connected_by) values(p_tenant,p_merchant,p_cipher,actor)
 on conflict(tenant_id) do update set cipher=excluded.cipher,connected_by=excluded.connected_by,connected_at=now();
 perform komisio_private.record_access(p_tenant,'paypal.credentials_saved',p_tenant,jsonb_build_object('merchant_id',p_merchant));
end $$;

create function public.read_paypal_credentials(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare connection public.paypal_credentials;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'zettle_pull') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into connection from public.paypal_credentials where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('merchantId',connection.merchant_id,'cipher',connection.cipher);
end $$;
revoke all on function public.store_paypal_credentials(uuid,uuid,jsonb),public.read_paypal_credentials(uuid) from public,anon;
grant execute on function public.store_paypal_credentials(uuid,uuid,jsonb),public.read_paypal_credentials(uuid) to authenticated;
