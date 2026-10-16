-- Distinguish first creation from retries without changing the existing creation rules.
create function public.create_tenant_with_result(p_name text,p_slug text,p_request_id uuid,p_locale text,p_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior uuid; tid uuid;
begin
 if p_request_id is null or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it') then
  raise exception 'INVALID_INPUT';
 end if;
 -- The old creation RPCs use the same lock. Only one caller can observe absence.
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 select id into prior from public.tenants where created_by=uid and creation_request_id=p_request_id;
 if p_currency is null then
  tid:=public.create_tenant_with_locale(p_name,p_slug,p_request_id,p_locale);
 else
  tid:=public.create_tenant_with_currency(p_name,p_slug,p_request_id,p_currency);
 end if;
 return jsonb_build_object('tenant_id',tid,'created',prior is null);
end $$;
revoke all on function public.create_tenant_with_result(text,text,uuid,text,text) from public,anon;
grant execute on function public.create_tenant_with_result(text,text,uuid,text,text) to authenticated;
