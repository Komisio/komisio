-- #717: exact own-item read for mobile S20, with the existing portal facts.
-- Authorization is independent of catalogue visibility: an existing seller
-- may still inspect their own sold/ended items, just as in my_items_page.
create function public.my_item_detail(p_tenant uuid,p_seller uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.items; f jsonb; t jsonb; n jsonb; row jsonb; sale record;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select * into i from public.items where tenant_id=p_tenant and seller_id=p_seller and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 t:=komisio_private.item_title(p_tenant,p_item);
 n:=komisio_private.next_markdown(f);
 select s.occurred_at,l.price_ore into sale
 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
 where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed'
 and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)
 order by s.occurred_at desc limit 1;
 row:=jsonb_build_object(
  'id',i.id,'reference','I-'||upper(left(i.id::text,8)),'acceptedAt',i.accepted_at,
  'title',t->>'title','category',t->>'category',
  'currentPriceOre',(f->>'currentPriceOre')::bigint,'acceptedPriceOre',(f->>'acceptedPriceOre')::bigint,
  'stage',f->>'stage','periodEnd',f->>'periodEnd','collectionDeadline',f->>'collectionDeadline',
  'endOfPeriodAction',f->>'endOfPeriodAction',
  'endedAs',komisio_private.item_period_state(p_tenant,p_item)->'detail'->>'action',
  'endedAt',case when f->>'stage'='ended' then
   (select e.occurred_at from public.item_events e where e.tenant_id=p_tenant and e.item_id=p_item and e.kind='period_ended' order by e.occurred_at desc,e.id desc limit 1)
   when f->>'stage'='period_ended' then (f->>'periodEnd')::timestamptz end,
  'soldAt',sale.occurred_at,'soldPriceOre',sale.price_ore,
  'nextMarkdownAt',n->>'at','nextMarkdownPercent',(n->>'percent')::numeric,'nextPriceOre',(n->>'priceOre')::bigint
 );
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),
  'automaticMarkdowns',coalesce((komisio_private.current_store_policy_core(p_tenant)->'policy'->>'automaticMarkdowns')::boolean,false),'item',row);
end $$;
revoke all on function public.my_item_detail(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.my_item_detail(uuid,uuid,uuid) to authenticated;

-- The new filter uses the existing engine stage. Old counts and signatures stay unchanged.
create or replace function public.my_items_page(p_tenant uuid,p_seller uuid,p_query text,p_offset integer,p_status text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; counts jsonb; automatic boolean; total integer; q text:=lower(btrim(coalesce(p_query,''))); skip integer:=coalesce(p_offset,0);
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if skip<0 or char_length(q)>120 or p_status is null or p_status not in ('active','sold','ended','all','expiring') then raise exception 'INVALID_INPUT'; end if;
 automatic:=coalesce((komisio_private.current_store_policy_core(p_tenant)->'policy'->>'automaticMarkdowns')::boolean,false);
 with candidates as materialized (
  select i.id,i.accepted_at,komisio_private.item_title(p_tenant,i.id) as t
  from public.items i where i.tenant_id=p_tenant and i.seller_id=p_seller
 ), matching as materialized (
  select * from candidates where q='' or strpos(lower(coalesce(t->>'title','')),q)>0
   or strpos(lower(coalesce(t->>'category','')),q)>0 or strpos(id::text,q)>0
   or strpos('i-'||left(id::text,8),q)>0
 ), facts as materialized (
  select m.*,komisio_private.item_lifecycle(p_tenant,m.id) as f from matching m
 ), scan as materialized (
  select * from facts where p_status='all'
   or (p_status='active' and f->>'stage' in ('on_sale','markdown_due','period_ending'))
   or (p_status='expiring' and f->>'stage'='period_ending')
   or (p_status='sold' and f->>'stage'='sold')
   or (p_status='ended' and f->>'stage' in ('period_ended','ended'))
 ), page as materialized (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',x.id,'reference','I-'||upper(left(x.id::text,8)),'acceptedAt',x.accepted_at,
   'title',x.t->>'title','category',x.t->>'category',
   'currentPriceOre',(x.f->>'currentPriceOre')::bigint,'acceptedPriceOre',(x.f->>'acceptedPriceOre')::bigint,
   'stage',x.f->>'stage','periodEnd',x.f->>'periodEnd','collectionDeadline',x.f->>'collectionDeadline','endOfPeriodAction',x.f->>'endOfPeriodAction',
   'endedAs',x.ended_as,'endedAt',x.ended_at,'soldAt',x.sold_at,'soldPriceOre',x.sold_price,
   'nextMarkdownAt',x.n->>'at','nextMarkdownPercent',(x.n->>'percent')::numeric,'nextPriceOre',(x.n->>'priceOre')::bigint
  ) order by x.accepted_at desc,x.id),'[]'::jsonb),(select count(*)::int from scan),
  (select jsonb_build_object(
   'active',count(*) filter(where f->>'stage' in ('on_sale','markdown_due','period_ending')),
   'sold',count(*) filter(where f->>'stage'='sold'),
   'ended',count(*) filter(where f->>'stage' in ('period_ended','ended'))
  ) from facts) into rows,total,counts
 from (
  select y.*,komisio_private.next_markdown(y.f) as n from (
   select i.id,i.accepted_at,
    i.t,
    i.f,
    (komisio_private.item_period_state(p_tenant,i.id)->'detail'->>'action') as ended_as,
    case when i.f->>'stage'='ended' then
     (select e.occurred_at from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='period_ended' order by e.occurred_at desc,e.id desc limit 1)
     when i.f->>'stage'='period_ended' then (i.f->>'periodEnd')::timestamptz end as ended_at,
    (select s.occurred_at from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
      where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
      and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1) as sold_at,
    (select l.price_ore from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
      where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
      and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1) as sold_price
   from page i
  ) y
 ) x;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'automaticMarkdowns',automatic,'items',rows,'total',total,'offset',skip,'counts',counts);
end $$;


notify pgrst,'reload schema';
