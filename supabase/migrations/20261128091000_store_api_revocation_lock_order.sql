-- Serialize revocation with in-flight direct writes using the same tenant-then-key order.
create or replace function public.revoke_store_inventory_key(p_tenant uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 update komisio_private.store_inventory_keys set revoked_at=now()
 where tenant_id=p_tenant and id=p_id and revoked_at is null;
 if found then perform komisio_private.record_access(p_tenant,'store_api.key_revoked',p_id,'{}'::jsonb); end if;
end $$;
