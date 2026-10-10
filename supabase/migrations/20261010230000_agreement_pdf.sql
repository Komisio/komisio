-- The existing archive checks identity, MFA, unique seller linkage and version access.
-- Add only the current saved names required by a read-only personal PDF copy.
create function public.my_seller_agreement_document(p_tenant uuid,p_seller uuid,p_version uuid,p_text uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare document jsonb; seller_name text; store_name text;
begin
 document:=public.my_seller_agreement_text(p_tenant,p_seller,p_version,0,p_text);
 select s.name,t.name into seller_name,store_name from public.sellers s
 join public.tenants t on t.id=s.tenant_id where s.tenant_id=p_tenant and s.id=p_seller;
 return jsonb_build_object('agreement',document->'agreement','sellerName',seller_name,'storeName',store_name);
end $$;
revoke all on function public.my_seller_agreement_document(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.my_seller_agreement_document(uuid,uuid,uuid,uuid) to authenticated;
