-- Seller portal, "my items" (owner request 2026-09-15): the seller's own
-- accepted items with the title from the origin, the current price, the
-- derived lifecycle stage, the period end and what the store does then, and
-- the sale date and price when sold. Same facts and same functions as the
-- staff lifecycle queue and the stock report; nothing new is computed. The
-- seller identity check is the portal's own (require_seller); no photos,
-- no staff reasons, no other seller's rows. Newest 200.
create function public.my_items(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',x.id,'reference','I-'||upper(left(x.id::text,8)),'acceptedAt',x.accepted_at,
   'title',x.t->>'title','category',x.t->>'category',
   'currentPriceOre',(x.f->>'currentPriceOre')::bigint,'acceptedPriceOre',(x.f->>'acceptedPriceOre')::bigint,
   'stage',x.f->>'stage','periodEnd',x.f->>'periodEnd','endOfPeriodAction',x.f->>'endOfPeriodAction',
   'endedAs',x.ended_as,'soldAt',x.sold_at,'soldPriceOre',x.sold_price
  ) order by x.accepted_at desc,x.id),'[]'::jsonb) into rows
 from (
  select i.id,i.accepted_at,
   komisio_private.item_title(p_tenant,i.id) as t,
   komisio_private.item_lifecycle(p_tenant,i.id) as f,
   (select e.detail->>'action' from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='period_ended' order by e.occurred_at desc limit 1) as ended_as,
   (select s.occurred_at from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
     where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
     and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1) as sold_at,
   (select l.price_ore from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
     where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
     and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1) as sold_price
  from public.items i where i.tenant_id=p_tenant and i.seller_id=p_seller order by i.accepted_at desc,i.id limit 200
 ) x;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'items',rows);
end $$;
revoke all on function public.my_items(uuid,uuid) from public,anon;
grant execute on function public.my_items(uuid,uuid) to authenticated;
