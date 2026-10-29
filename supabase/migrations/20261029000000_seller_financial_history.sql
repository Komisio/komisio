-- Additive seller-owned history. Existing economy/detail contracts stay intact.
create function public.my_seller_payouts_page(p_tenant uuid,p_seller uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if p_offset is null or p_offset<0 or p_offset>2500000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into total from public.payouts where tenant_id=p_tenant and seller_id=p_seller;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc,x.id),'[]') into rows from (
  select id,amount_ore,status,request_source,requested_at from public.payouts
  where tenant_id=p_tenant and seller_id=p_seller order by requested_at desc,id limit 25 offset p_offset
 ) x;
 return jsonb_build_object('tenantId',p_tenant,'sellerId',p_seller,'currency',komisio_private.store_currency(p_tenant),
  'balance',komisio_private.seller_balance_facts(p_tenant,p_seller),'thresholdOre',komisio_private.payout_threshold_ore(p_tenant),
  'payouts',rows,'total',total,'offset',p_offset,'limit',25);
end $$;

create function public.my_seller_statements_page(p_tenant uuid,p_seller uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if p_offset is null or p_offset<0 or p_offset>2500000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into total from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.number desc,x.id),'[]') into rows from (
  select id,number,kind,corrects_id,period_from,period_to,opening_ore,closing_ore,issued_at,
   (self_billing is not null) as is_self_billing
  from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller
  order by number desc,id limit 25 offset p_offset
 ) x;
 return jsonb_build_object('tenantId',p_tenant,'sellerId',p_seller,'currency',komisio_private.store_currency(p_tenant),
  'statements',rows,'total',total,'offset',p_offset,'limit',25);
end $$;
revoke all on function public.my_seller_payouts_page(uuid,uuid,integer),public.my_seller_statements_page(uuid,uuid,integer) from public,anon;
grant execute on function public.my_seller_payouts_page(uuid,uuid,integer),public.my_seller_statements_page(uuid,uuid,integer) to authenticated;
