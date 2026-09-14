create or replace function public.begin_fortnox_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.fortnox_connections; e public.accounting_exports; close public.day_closes; prior public.fortnox_voucher_sends; open_row public.fortnox_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.export_id<>p_export or prior.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',false);
 end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then raise exception 'FORTNOX_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>'SEK' then raise exception 'FORTNOX_CURRENCY_UNSUPPORTED'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 select * into open_row from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status in ('pending','sent');
 if found then
  if open_row.status='sent' then raise exception 'FORTNOX_ALREADY_SENT'; end if;
  raise exception 'FORTNOX_SEND_IN_PROGRESS';
 end if;
 if exists(select 1 from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status='failed' and error_code not in ('FORTNOX_PREFLIGHT_FAILED','FORTNOX_WRONG_COMPANY')) then raise exception 'FORTNOX_OUTCOME_UNKNOWN'; end if;
 insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,'pending',uid);
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',true);
end $$;
