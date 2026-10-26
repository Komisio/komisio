-- Current settings explain the portal; published legal text remains literal.
create function public.my_seller_terms_summary(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare policy jsonb; latest public.seller_terms_versions; seller public.sellers;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 policy:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 select * into seller from public.sellers where tenant_id=p_tenant and id=p_seller;
 select * into latest from public.seller_terms_versions where tenant_id=p_tenant and seller_id=p_seller order by version desc limit 1;
 return jsonb_build_object(
  'sellerName',seller.name,
  'commissionBasis',coalesce(latest.commission_basis,case when seller.seller_type='business' then 'exclusive' else policy->>'commissionBasis' end),
  'commissionRatePercent',coalesce(latest.commission_rate_percent,(policy->>'commissionRatePercent')::numeric),
  'salePeriodDays',(policy->>'salePeriodDays')::integer,
  'months',(policy->'consignmentPeriod'->>'months')::integer,
  'collectionDays',(policy->'consignmentPeriod'->>'collectionDays')::integer,
  -- Calendar receipt terms already override the legacy end action with collection.
  'endOfPeriodAction',case when policy ? 'consignmentPeriod' then 'return' else policy->>'endOfPeriodAction' end);
end $$;
revoke all on function public.my_seller_terms_summary(uuid,uuid) from public,anon;
grant execute on function public.my_seller_terms_summary(uuid,uuid) to authenticated;
