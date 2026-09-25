-- Complete seller-owned search; retain the legacy capped read during rollout.
create function public.my_items_page(p_tenant uuid,p_seller uuid,p_query text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; automatic boolean; total integer; q text:=lower(btrim(coalesce(p_query,''))); skip integer:=coalesce(p_offset,0);
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if skip<0 or char_length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 automatic:=coalesce((komisio_private.current_store_policy_core(p_tenant)->'policy'->>'automaticMarkdowns')::boolean,false);
 with candidates as materialized (
  select i.id,i.accepted_at,komisio_private.item_title(p_tenant,i.id) as t
  from public.items i where i.tenant_id=p_tenant and i.seller_id=p_seller
 ), scan as materialized (
  select * from candidates where q='' or strpos(lower(coalesce(t->>'title','')),q)>0
   or strpos(lower(coalesce(t->>'category','')),q)>0 or strpos(id::text,q)>0
   or strpos('i-'||left(id::text,8),q)>0
 ), page as materialized (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',x.id,'reference','I-'||upper(left(x.id::text,8)),'acceptedAt',x.accepted_at,
   'title',x.t->>'title','category',x.t->>'category',
   'currentPriceOre',(x.f->>'currentPriceOre')::bigint,'acceptedPriceOre',(x.f->>'acceptedPriceOre')::bigint,
   'stage',x.f->>'stage','periodEnd',x.f->>'periodEnd','endOfPeriodAction',x.f->>'endOfPeriodAction',
   'endedAs',x.ended_as,'soldAt',x.sold_at,'soldPriceOre',x.sold_price,
   'nextMarkdownAt',x.n->>'at','nextMarkdownPercent',(x.n->>'percent')::numeric,'nextPriceOre',(x.n->>'priceOre')::bigint
  ) order by x.accepted_at desc,x.id),'[]'::jsonb),(select count(*)::int from scan) into rows,total
 from (
  select y.*,komisio_private.next_markdown(y.f) as n from (
   select i.id,i.accepted_at,
    i.t,
    komisio_private.item_lifecycle(p_tenant,i.id) as f,
    (select e.detail->>'action' from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='period_ended' order by e.occurred_at desc limit 1) as ended_as,
    (select s.occurred_at from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
      where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
      and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1) as sold_at,
    (select l.price_ore from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
      where l.tenant_id=p_tenant and l.item_id=i.id and s.status='completed'
      and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1) as sold_price
   from page i
  ) y
 ) x;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'automaticMarkdowns',automatic,'items',rows,'total',total,'offset',skip);
end $$;

revoke all on function public.my_items_page(uuid,uuid,text,integer) from public,anon;
grant execute on function public.my_items_page(uuid,uuid,text,integer) to authenticated;
