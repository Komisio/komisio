-- Price rows written in the same transaction share set_at, so "the newest
-- price" was decided by random ids. An identity column makes the series
-- strictly ordered; every current-price read orders by it from now on.
alter table public.item_prices add column seq bigint generated always as identity;
create index item_prices_item_seq on public.item_prices(tenant_id,item_id,seq desc);

create or replace function komisio_private.item_lifecycle(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; period_days integer; extension_days integer; period_end timestamptz; ended boolean; sold boolean; accepted_price bigint; current_price bigint;
 steps jsonb; step jsonb; idx integer:=0; due_step integer; due_percent numeric; applied integer[];
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 period_days:=coalesce((item.terms->>'salePeriodDays')::integer,0);
 select coalesce(sum((detail->>'days')::integer),0) into extension_days from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_extended';
 period_end:=item.accepted_at+make_interval(days=>period_days+extension_days);
 ended:=exists(select 1 from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_ended');
 sold:=exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed'
  and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id));
 select price_ore into accepted_price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by seq limit 1;
 select price_ore into current_price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by seq desc limit 1;
 select coalesce(array_agg((detail->>'step')::integer),'{}') into applied from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='markdown_applied';
 steps:=coalesce(item.terms->'markdownSteps','[]'::jsonb);
 for step in select * from jsonb_array_elements(steps) loop
  idx:=idx+1;
  if due_step is null and not (idx=any(applied)) and item.accepted_at+make_interval(days=>(step->>'afterDays')::integer)<=now() then
   due_step:=idx; due_percent:=(step->>'percent')::numeric;
  end if;
 end loop;
 return jsonb_build_object('itemId',item.id,'sellerId',item.seller_id,'ownership',item.ownership,'acceptedAt',item.accepted_at,'periodEnd',period_end,'periodDays',period_days,'extensionDays',extension_days,
  'ended',ended,'sold',sold,'acceptedPriceOre',accepted_price,'currentPriceOre',current_price,'dueStep',due_step,'duePercent',due_percent,'appliedSteps',to_jsonb(applied),'steps',steps,
  'endOfPeriodAction',item.terms->>'endOfPeriodAction',
  'stage',case when sold then 'sold' when ended then 'ended' when due_step is not null then 'markdown_due' when period_end<=now() then 'period_ended' when period_end<=now()+interval '7 days' then 'period_ending' else 'on_sale' end);
end $$;
