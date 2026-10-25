-- #626: taxpayer facts are independent of commission terms. Existing sale lines
-- remain immutable; only future line facts use this selector.
do $$ declare definition text; begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_business(');
 definition:=pg_get_functiondef('komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb)'::regprocedure);
 if position('seller_taxable:=basis=''exclusive'';' in definition)=0 then raise exception 'UNEXPECTED_SALE_FACTS'; end if;
 definition:=replace(definition,'declare item public.items;', 'declare seller public.sellers; item public.items;');
 definition:=replace(definition,'seller_taxable:=basis=''exclusive'';',
  'select * into seller from public.sellers where tenant_id=p_tenant and id=item.seller_id;
   if not found then raise exception ''SELLER_NOT_FOUND''; end if;
   seller_taxable:=seller.seller_type=''business'' and coalesce((seller.profile->''business''->>''vatRegistered'')::boolean,false);');
 definition:=replace(definition,'if seller_taxable then mode:=''consignment_business'';',
  'if seller_taxable then mode:=coalesce(p_policy->>''vatModeConsignmentBusiness'',''consignment_business'');');
 definition:=replace(definition,'''commissionExVatOre'',case when seller_taxable then commission else null end',
  '''sellerType'',seller.seller_type,''sellerTaxable'',seller_taxable,''sellerVatNumber'',coalesce(seller.profile->''business''->>''vatNumber'',''''),''sellerProfileRevision'',seller.profile_revision,''commissionExVatOre'',case when basis=''exclusive'' then commission else null end');
 execute definition;
end $$;
revoke all on function komisio_private.valid_store_policy_before_business(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(komisio_private.valid_store_policy_before_business(value-'vatModeConsignmentBusiness') and
  (not(value ? 'vatModeConsignmentBusiness') or (jsonb_typeof(value->'vatModeConsignmentBusiness')='string'
   and value->>'vatModeConsignmentBusiness' in ('consignment_business','consignment_margin'))),false)
$$;
