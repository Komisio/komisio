-- Shared by the authorized read and the insert boundary for every payout command.
create function komisio_private.central_payout_bank_missing(p_tenant uuid, p_seller uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.platform_settings where only_row and central_app_tenant_id=p_tenant)
    and not exists(select 1 from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller)
$$;
revoke all on function komisio_private.central_payout_bank_missing(uuid,uuid) from public,anon,authenticated;

create function komisio_private.require_central_payout_bank() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if komisio_private.central_payout_bank_missing(new.tenant_id,new.seller_id) then
  raise exception 'PAYOUT_BANK_REQUIRED';
 end if;
 return new;
end $$;
revoke all on function komisio_private.require_central_payout_bank() from public,anon,authenticated;
-- Command replay returns before insertion. Pending historical requests are not rewritten.
create trigger central_payout_bank before insert on public.payouts
 for each row execute function komisio_private.require_central_payout_bank();

create or replace function public.my_seller_payouts_page(p_tenant uuid,p_seller uuid,p_offset integer default 0) returns jsonb
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
  'payouts',rows,'total',total,'offset',p_offset,'limit',25,
  'bankAccountMissing',komisio_private.central_payout_bank_missing(p_tenant,p_seller));
end $$;
notify pgrst,'reload schema';
