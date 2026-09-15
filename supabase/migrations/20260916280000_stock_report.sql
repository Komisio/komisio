-- Stock report (P3 reports, Fable): margin, sell-through and stock age per
-- category for one period, from the store's own facts. Read only, any member.
-- Definitions, fixed here so the page, the agent and the chain view agree:
--   in stock: accepted items with no completed, unreturned sale line and no
--             period_ended event, valued at the current price;
--   age:      days from acceptance to now, in four buckets matching the default
--             markdown schedule (0-14, 15-28, 29-42, 43 and more);
--   sold:     completed, unreturned lines whose sale occurred in the period;
--   margin:   the store's share of a sold line: commission for consignment,
--             price minus VAT minus purchase price for store-owned (from the
--             frozen terms); never a forecast;
--   sell-through: sold in the period divided by sold plus in stock now.
-- Categories come from the origin's category through item_title; items with
-- none are grouped as an empty category.
create function public.stock_report(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p_start timestamptz; p_end timestamptz; rows jsonb; total jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_INPUT'; end if;
 p_start:=(p_from::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 p_end:=((p_to+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 with facts as (
  select i.id as item_id,
   coalesce(komisio_private.item_title(p_tenant,i.id)->>'category','') as category,
   i.ownership, i.accepted_at,
   (select p.price_ore from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by p.set_at desc,p.seq desc limit 1) as current_price,
   (i.terms->>'purchasePriceOre')::bigint as purchase_price,
   exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='period_ended') as ended,
   s.occurred_at as sold_at, l.price_ore as sold_price, l.vat_ore as sold_vat, l.commission_ore as sold_commission
  from public.items i
  left join lateral (
   select l.price_ore,l.vat_ore,l.commission_ore,l.sale_id from public.sale_lines l
   join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id
   where l.tenant_id=p_tenant and l.item_id=i.id and sa.status='completed'
    and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)
   order by sa.occurred_at desc limit 1) l on true
  left join public.sales s on s.tenant_id=p_tenant and s.id=l.sale_id
  where i.tenant_id=p_tenant
 ), classified as (
  select *, (sold_at is not null) as sold,
   (sold_at is not null and sold_at>=p_start and sold_at<p_end) as sold_in_period,
   case when sold_at is null then null when ownership='consignment' then sold_commission else sold_price-sold_vat-coalesce(purchase_price,0) end as margin,
   greatest(0,floor(extract(epoch from (now()-accepted_at))/86400))::int as age_days,
   case when sold_at is null then null else greatest(0,floor(extract(epoch from (sold_at-accepted_at))/86400))::int end as days_to_sale
  from facts
 ), per_category as (
  select category,
   count(*) filter (where not sold and not ended) as in_stock,
   coalesce(sum(current_price) filter (where not sold and not ended),0) as stock_value,
   round(avg(age_days) filter (where not sold and not ended))::int as avg_age,
   max(age_days) filter (where not sold and not ended) as oldest_age,
   count(*) filter (where not sold and not ended and age_days<=14) as age_0_14,
   count(*) filter (where not sold and not ended and age_days between 15 and 28) as age_15_28,
   count(*) filter (where not sold and not ended and age_days between 29 and 42) as age_29_42,
   count(*) filter (where not sold and not ended and age_days>=43) as age_43_plus,
   count(*) filter (where sold_in_period) as sold_count,
   coalesce(sum(sold_price) filter (where sold_in_period),0) as sold_gross,
   coalesce(sum(margin) filter (where sold_in_period),0) as margin_sum,
   round(avg(days_to_sale) filter (where sold_in_period))::int as avg_days_to_sale
  from classified group by category
 )
 select
  coalesce((select jsonb_agg(jsonb_build_object('category',c.category,'inStock',c.in_stock,'stockValueOre',c.stock_value,'averageAgeDays',c.avg_age,'oldestAgeDays',c.oldest_age,
    'ageBuckets',jsonb_build_object('d0to14',c.age_0_14,'d15to28',c.age_15_28,'d29to42',c.age_29_42,'d43plus',c.age_43_plus),
    'soldCount',c.sold_count,'soldGrossOre',c.sold_gross,'marginOre',c.margin_sum,
    'marginPercent',case when c.sold_gross>0 then round(c.margin_sum::numeric*100/c.sold_gross,1) else null end,
    'sellThroughPercent',case when c.sold_count+c.in_stock>0 then round(c.sold_count::numeric*100/(c.sold_count+c.in_stock),1) else null end,
    'averageDaysToSale',c.avg_days_to_sale) order by c.sold_gross desc,c.in_stock desc,c.category) from per_category c),'[]'::jsonb),
  (select jsonb_build_object('inStock',coalesce(sum(in_stock),0),'stockValueOre',coalesce(sum(stock_value),0),
    'ageBuckets',jsonb_build_object('d0to14',coalesce(sum(age_0_14),0),'d15to28',coalesce(sum(age_15_28),0),'d29to42',coalesce(sum(age_29_42),0),'d43plus',coalesce(sum(age_43_plus),0)),
    'soldCount',coalesce(sum(sold_count),0),'soldGrossOre',coalesce(sum(sold_gross),0),'marginOre',coalesce(sum(margin_sum),0),
    'marginPercent',case when coalesce(sum(sold_gross),0)>0 then round(sum(margin_sum)::numeric*100/sum(sold_gross),1) else null end,
    'sellThroughPercent',case when coalesce(sum(sold_count)+sum(in_stock),0)>0 then round(sum(sold_count)::numeric*100/(sum(sold_count)+sum(in_stock)),1) else null end) from per_category)
 into rows,total;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'from',p_from,'to',p_to,'timeZone','Europe/Stockholm','categories',rows,'total',total);
end $$;
revoke all on function public.stock_report(uuid,date,date) from public,anon;
grant execute on function public.stock_report(uuid,date,date) to authenticated;
