-- Pilot gates: tighten function exposure and add the scoped seller data
-- export. Two functions that already require an authenticated member were
-- still executable by anon through the default PUBLIC grant; revoking changes
-- nothing for members and removes an anonymous entry point. The export reads
-- every row Komisio holds about one seller for the owner or an admin, logged
-- as an access event, so a data request can be answered from one call.
revoke execute on function public.usage_summary(uuid,text) from public,anon;
revoke execute on function public.reserve_reception_assistance(uuid,uuid,uuid,integer,text,text) from public,anon;

create function public.seller_data_export(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.sellers; result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 result:=jsonb_build_object(
  'exportedAt',now(),'exportedBy',uid,'tenantId',p_tenant,
  'seller',to_jsonb(s)-'tenant_id',
  'terms',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.version),'[]') from public.seller_terms_versions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'agreementEvidence',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.recorded_at),'[]') from public.seller_agreement_evidence x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'notificationPreferences',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.seller_notification_preferences x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'bags',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.bag_receipts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'inspectionDrafts',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.inspection_draft_revisions x where x.tenant_id=p_tenant and x.bag_id in (select id from public.bag_receipts where tenant_id=p_tenant and seller_id=p_seller)),
  'receptions',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_sessions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'receptionSources',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.reception_source_revisions x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'receptionReviews',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_reviews x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'garments',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.garment_receipts x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'items',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.accepted_at),'[]') from public.items x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'itemEvents',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.item_events x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'itemPrices',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.item_prices x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'saleLines',(select coalesce(jsonb_agg((to_jsonb(l)-'tenant_id')||jsonb_build_object('sale',to_jsonb(sa)-'tenant_id') order by sa.occurred_at),'[]') from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id where l.tenant_id=p_tenant and l.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'returns',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.sale_returns x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'ledger',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at,x.id),'[]') from public.seller_ledger_entries x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'payouts',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.requested_at),'[]') from public.payouts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'payoutEvents',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.payout_events x where x.tenant_id=p_tenant and x.payout_id in (select id from public.payouts where tenant_id=p_tenant and seller_id=p_seller)),
  'statements',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.number),'[]') from public.settlement_statements x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'statementLines',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.statement_id,x.line_no),'[]') from public.settlement_statement_lines x where x.tenant_id=p_tenant and x.statement_id in (select id from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller)),
  'communications',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.queued_at),'[]') from public.seller_communications x where x.tenant_id=p_tenant and x.seller_id=p_seller)
 );
 perform komisio_private.record_access(p_tenant,'seller.exported',p_seller,jsonb_build_object('items',jsonb_array_length(result->'items'),'ledger',jsonb_array_length(result->'ledger')));
 return result;
end $$;
revoke all on function public.seller_data_export(uuid,uuid) from public,anon;
grant execute on function public.seller_data_export(uuid,uuid) to authenticated;
