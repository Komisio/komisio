-- Protocol 5 adds the payout fact to purchase copy only. Keep older JSON shapes.
create or replace function public.seller_push_candidates(p_protocol integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_push_worker();
 if p_protocol is null or p_protocol not in (2,3,4,5) then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg((to_jsonb(x) - 'reference_id')
  || case when p_protocol >= 3 then jsonb_build_object('approved',exists(
   select 1 from public.external_item_offers o where o.id=x."offerId" and o.approval_source='fixed_request'
  )) else '{}'::jsonb end
  || case when p_protocol >= 5 and x.kind='external_item_purchased' then jsonb_build_object('payoutRegistered',exists(
   select 1 from komisio_private.central_payout_destinations dest
   join public.payouts p on p.tenant_id=dest.tenant_id and p.id=dest.payout_id and p.seller_id=dest.seller_id
   where dest.tenant_id=x."tenantId" and dest.credit_id=x.reference_id and p.request_source='automatic'
    and p.status in ('requested','approved','paid')
  )) else '{}'::jsonb end order by x."createdAt",x.id),'[]'::jsonb) into result
 from (
  select q.id,q.reference_id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",
   q.request_id as "requestId",q.owner_id as "ownerId",
   case when q.kind='external_item_offered' then q.reference_id end as "offerId",
   q.kind,q.created_at as "createdAt",d.locale,left(t.name,120) as "storeName",
   left(coalesce(nullif(komisio_private.item_title(q.tenant_id,q.item_id)->>'title',''),'Komisio'),120) as "itemLabel"
  from komisio_private.seller_push_deliveries q join komisio_private.seller_push_devices d on d.id=q.device_id
  join public.tenants t on t.id=q.tenant_id
  where q.state='queued' and (p_protocol>=4 or q.kind<>'external_item_purchased')
  order by q.created_at,q.id limit 50
 ) x;
 return result;
end $$;
