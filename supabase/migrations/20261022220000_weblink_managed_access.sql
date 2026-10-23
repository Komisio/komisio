-- Owner/admin setup authority is checked in the database before and after
-- retrieving a sensitive printer configuration from the managed gateway.
create function public.authorize_weblink_setup(p_tenant uuid,p_printer uuid,p_device uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport='weblink') then raise exception 'PRINTER_NOT_FOUND'; end if;
 if p_device is not null and not exists(select 1 from public.print_devices where tenant_id=p_tenant and printer_id=p_printer and id=p_device and revoked_at is null) then raise exception 'DEVICE_NOT_FOUND'; end if;
 return true;
end $$;
revoke all on function public.authorize_weblink_setup(uuid,uuid,uuid) from public,anon;
grant execute on function public.authorize_weblink_setup(uuid,uuid,uuid) to authenticated;
