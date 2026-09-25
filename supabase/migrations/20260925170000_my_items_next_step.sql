-- Seller portal, "what happens next" (2026-09-25): my_items also tells the
-- seller the next frozen markdown step that is not yet applied (when, what
-- percent, what price) and whether the store applies steps automatically.
-- The price is the expression apply_markdown records (a share of the accepted
-- price, never compounded), read from the same lifecycle facts, so the portal
-- shows what the engine would write. Nothing is written; the wording in the
-- portal promises a price only when the store's policy applies steps itself.

-- The first frozen step not yet applied to an unsold item, from its lifecycle facts; null when nothing remains inside the period.
create function komisio_private.next_markdown(f jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare step jsonb; idx integer:=0; due_at timestamptz; accepted bigint; percent numeric;
begin
 if f is null or f->>'stage' not in ('on_sale','markdown_due','period_ending') then return null; end if;
 accepted:=(f->>'acceptedPriceOre')::bigint;
 if accepted is null then return null; end if;
 for step in select * from jsonb_array_elements(coalesce(f->'steps','[]'::jsonb)) loop
  idx:=idx+1;
  if not (to_jsonb(idx) <@ coalesce(f->'appliedSteps','[]'::jsonb)) then
   due_at:=(f->>'acceptedAt')::timestamptz+make_interval(days=>(step->>'afterDays')::integer);
   if due_at>(f->>'periodEnd')::timestamptz then return null; end if;
   percent:=(step->>'percent')::numeric;
   return jsonb_build_object('step',idx,'at',due_at,'percent',percent,
    'priceOre',greatest(accepted-komisio_private.share_ore(accepted,round(percent*100)::integer),1));
  end if;
 end loop;
 return null;
end $$;
revoke all on function komisio_private.next_markdown(jsonb) from public,anon,authenticated;

create or replace function public.my_items(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; automatic boolean;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 automatic:=coalesce((komisio_private.current_store_policy_core(p_tenant)->'policy'->>'automaticMarkdowns')::boolean,false);
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',x.id,'reference','I-'||upper(left(x.id::text,8)),'acceptedAt',x.accepted_at,
   'title',x.t->>'title','category',x.t->>'category',
   'currentPriceOre',(x.f->>'currentPriceOre')::bigint,'acceptedPriceOre',(x.f->>'acceptedPriceOre')::bigint,
   'stage',x.f->>'stage','periodEnd',x.f->>'periodEnd','endOfPeriodAction',x.f->>'endOfPeriodAction',
   'endedAs',x.ended_as,'soldAt',x.sold_at,'soldPriceOre',x.sold_price,
   'nextMarkdownAt',x.n->>'at','nextMarkdownPercent',(x.n->>'percent')::numeric,'nextPriceOre',(x.n->>'priceOre')::bigint
  ) order by x.accepted_at desc,x.id),'[]'::jsonb) into rows
 from (
  select y.*,komisio_private.next_markdown(y.f) as n from (
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
  ) y
 ) x;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'automaticMarkdowns',automatic,'items',rows);
end $$;
