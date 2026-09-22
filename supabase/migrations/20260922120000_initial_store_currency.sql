-- Initialize store currency through the existing policy authority in one transaction.
-- The original creation RPC stays compatible for existing clients and retries.
create function public.create_tenant_with_locale(p_name text,p_slug text,p_request_id uuid,p_locale text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior uuid; tid uuid; currency text; policy jsonb;
begin
 if p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it') or p_request_id is null then
  raise exception 'INVALID_INPUT';
 end if;
 -- Share the creation lock with the original RPC, including requests from old clients.
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 select id into prior from public.tenants where created_by=uid and creation_request_id=p_request_id;
 tid:=public.create_tenant(p_name,p_slug,p_request_id);
 if prior is null then
  currency:=case p_locale when 'sv' then 'SEK' when 'no' then 'NOK' when 'dk' then 'DKK' else 'EUR' end;
  policy:=(public.current_store_policy(tid)->'policy') || jsonb_build_object('currency',currency);
  perform public.publish_store_policy(tid,gen_random_uuid(),null,policy);
 end if;
 return tid;
end $$;
revoke all on function public.create_tenant_with_locale(text,text,uuid,text) from public,anon;
grant execute on function public.create_tenant_with_locale(text,text,uuid,text) to authenticated;
