-- #637: possession of a current registration capability reveals only the store name.
create function public.public_seller_registration_store(p_token text) returns text
language sql stable security definer set search_path='' as $$
 select t.name from public.seller_registration_links l
 join public.tenants t on t.id=l.tenant_id
 where p_token ~ '^[a-f0-9]{64}$' and l.token=p_token and l.enabled
  and not exists(select 1 from public.seller_registration_links newer where newer.tenant_id=l.tenant_id and newer.version>l.version)
  and exists(select 1 from public.seller_agreement_versions a where a.tenant_id=l.tenant_id)
$$;
revoke all on function public.public_seller_registration_store(text) from public;
grant execute on function public.public_seller_registration_store(text) to anon,authenticated;
