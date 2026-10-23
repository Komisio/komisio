-- Windows already supports the local USB spooler. Use the same scoped pairing
-- authority and one-time code as network printers; no change to device grants.
create or replace function public.create_print_pairing_code(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); code text; expires timestamptz:=now()+interval '15 minutes';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport in ('tcp','usb','weblink')) then raise exception 'PRINTER_NOT_FOUND'; end if;
 code:=upper(left(replace(gen_random_uuid()::text,'-',''),10));
 insert into public.print_pairing_codes(tenant_id,printer_id,code_hash,created_by,expires_at) values(p_tenant,p_printer,encode(sha256(convert_to(code,'UTF8')),'hex'),uid,expires);
 perform komisio_private.record_access(p_tenant,'print.pairing_code_created',p_printer,jsonb_build_object('expires_at',expires));
 return jsonb_build_object('code',left(code,5)||'-'||right(code,5),'expiresAt',expires);
end $$;
