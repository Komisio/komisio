-- Staged imports use the same staff registration command. Public seller
-- applications remain private and cannot set these facts.
do $$ declare definition text; begin
 execute replace(pg_get_functiondef('komisio_private.op_validate_import_sellers(jsonb)'::regprocedure),
  'FUNCTION komisio_private.op_validate_import_sellers(', 'FUNCTION komisio_private.op_validate_import_sellers_before_business(');
 definition:=pg_get_functiondef('komisio_private.op_execute_import_sellers(uuid,uuid,jsonb)'::regprocedure);
 if position('perform public.register_seller(p_tenant,gen_random_uuid(),entry->>''name'',entry->>''email'',entry->>''phone'');' in definition)=0 then raise exception 'UNEXPECTED_IMPORT'; end if;
 definition:=replace(definition,'perform public.register_seller(p_tenant,gen_random_uuid(),entry->>''name'',entry->>''email'',entry->>''phone'');',
  'if entry->>''sellerType''=''business'' then
    perform public.register_seller_with_profile(p_tenant,gen_random_uuid(),jsonb_build_object(''addressLine1'','''',''addressLine2'','''',''postalCode'','''',''city'','''',''country'','''',''language'','''',''notes'','''')||entry);
   else perform public.register_seller(p_tenant,gen_random_uuid(),entry->>''name'',entry->>''email'',entry->>''phone''); end if;');
 execute definition;
end $$;
revoke all on function komisio_private.op_validate_import_sellers_before_business(jsonb) from public,anon,authenticated;
create or replace function komisio_private.op_validate_import_sellers(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; cleaned jsonb;
begin
 if jsonb_typeof(value->'rows') is distinct from 'array' then return false; end if;
 for entry in select * from jsonb_array_elements(value->'rows') loop
  if entry ? 'sellerType' and (jsonb_typeof(entry->'sellerType')<>'string' or entry->>'sellerType' not in ('private','business')) then return false; end if;
  if entry ? 'business' and (coalesce(entry->>'sellerType','private')<>'business' or not komisio_private.valid_business_details(entry->'business')) then return false; end if;
 end loop;
 select coalesce(jsonb_agg(e-array['sellerType','business']),'[]') into cleaned from jsonb_array_elements(value->'rows') e;
 return komisio_private.op_validate_import_sellers_before_business(jsonb_set(value,'{rows}',cleaned));
end $$;

create function public.my_seller_business(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 return (select jsonb_build_object('sellerType',seller_type,'business',profile->'business')
  from public.sellers where tenant_id=p_tenant and id=p_seller);
end $$;
revoke all on function public.my_seller_business(uuid,uuid) from public,anon;
grant execute on function public.my_seller_business(uuid,uuid) to authenticated;
