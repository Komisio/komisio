-- Pilot enablement is an explicit owner action, not physical certification.
-- Serialize with pairing, revocation and queue claims on the existing tenant lock.
create function public.set_weblink_pilot(p_tenant uuid,p_printer uuid,p_active boolean,p_device uuid,p_acknowledged boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); printer public.printers;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_active is null or (p_active and (p_device is null or p_acknowledged is distinct from true)) then raise exception 'INVALID_INPUT'; end if;
 select * into printer from public.printers where tenant_id=p_tenant and id=p_printer and transport='weblink';
 if not found then raise exception 'PRINTER_NOT_FOUND'; end if;
 if p_active then
  if not exists(select 1 from public.print_devices where tenant_id=p_tenant and printer_id=p_printer and id=p_device and revoked_at is null) then raise exception 'DEVICE_NOT_FOUND'; end if;
  if exists(select 1 from public.print_jobs where tenant_id=p_tenant and printer_id=p_printer and status in ('dispatching','outcome_unknown')) then raise exception 'PRINT_OUTCOME_HELD'; end if;
 end if;
 if printer.active=p_active then return p_printer; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.printers set active=p_active where id=p_printer;
 perform set_config('komisio.print_transition','',true);
 perform komisio_private.record_access(p_tenant,case when p_active then 'print.pilot_enabled' else 'print.pilot_paused' end,p_printer,jsonb_build_object('device_id',case when p_active then p_device else null end,'physical_acceptance',false));
 return p_printer;
end $$;
revoke all on function public.set_weblink_pilot(uuid,uuid,boolean,uuid,boolean) from public,anon;
grant execute on function public.set_weblink_pilot(uuid,uuid,boolean,uuid,boolean) to authenticated;
