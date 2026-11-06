-- Explicit bounded reads for new mobile clients; keep the legacy five-row RPC.
create function public.my_recent_sales(p_tenant uuid,p_seller uuid,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if p_limit is null or p_limit<1 or p_limit>20 then
  raise exception using errcode='22023',message='INVALID_LIMIT';
 end if;
 with recent as materialized (
  select i.id,l.id as line_id,s.occurred_at,l.price_ore
  from public.items i
  join public.sale_lines l on l.tenant_id=i.tenant_id and l.item_id=i.id
  join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where i.tenant_id=p_tenant and i.seller_id=p_seller and s.status='completed'
   and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)
  order by s.occurred_at desc,l.id desc
  limit p_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'reference','I-'||upper(left(r.id::text,8)),
  'title',komisio_private.item_title(p_tenant,r.id)->>'title',
  'soldAt',r.occurred_at,'soldPriceOre',r.price_ore
 ) order by r.occurred_at desc,r.line_id desc),'[]'::jsonb) into rows from recent r;
 return jsonb_build_object('sellerId',p_seller,'currency',komisio_private.store_currency(p_tenant),'limit',p_limit,'items',rows);
end $$;
revoke all on function public.my_recent_sales(uuid,uuid,integer) from public,anon;
grant execute on function public.my_recent_sales(uuid,uuid,integer) to authenticated;

-- No default argument on the overload: PostgREST must resolve both signatures.
create or replace function public.my_recent_sales(p_tenant uuid,p_seller uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.my_recent_sales(p_tenant,p_seller,5)
$$;
revoke all on function public.my_recent_sales(uuid,uuid) from public,anon;
grant execute on function public.my_recent_sales(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
