-- P2 S10: VAT modes as pure database arithmetic, mirroring lib/engine/vat.ts.
-- The mode is a tenant setting; this function only computes what the mode says.
-- Integer öre in and out, rate in basis points (25 % = 2500), round half up.
create function komisio_private.vat_from_gross(p_amount_ore bigint,p_rate_bp integer) returns bigint
language sql immutable set search_path='' as $$
 select case when p_amount_ore<=0 or p_rate_bp<=0 then 0
  else div((p_amount_ore::numeric*p_rate_bp)*2+(10000+p_rate_bp),2*(10000+p_rate_bp)) end::bigint;
$$;
-- div() truncates: floor((2·num + den) / (2·den)) is round-half-up for non-negative integers.
-- A plain numeric division cast to bigint would round half to nearest instead.
create function komisio_private.vat_on_net(p_amount_ore bigint,p_rate_bp integer) returns bigint
language sql immutable set search_path='' as $$
 select case when p_amount_ore<=0 or p_rate_bp<=0 then 0
  else div((p_amount_ore::numeric*p_rate_bp)*2+10000,2*10000) end::bigint;
$$;

create function komisio_private.vat_for_line(p_mode text,p_price_ore bigint,p_seller_credit_ore bigint,p_purchase_price_ore bigint,p_rate_bp integer) returns bigint
language plpgsql immutable set search_path='' as $$
begin
 if p_price_ore is null or p_price_ore<0 or p_rate_bp is null or p_rate_bp<0 or p_rate_bp>10000 then raise exception 'INVALID_INPUT'; end if;
 case p_mode
  when 'consignment_margin' then
   if p_seller_credit_ore is null then raise exception 'VAT_BASIS_MISSING'; end if;
   return komisio_private.vat_from_gross(p_price_ore-p_seller_credit_ore,p_rate_bp);
  when 'consignment_full','consignment_business','store_full' then
   return komisio_private.vat_from_gross(p_price_ore,p_rate_bp);
  when 'store_margin' then
   if p_purchase_price_ore is null then raise exception 'VAT_BASIS_MISSING'; end if;
   return komisio_private.vat_from_gross(greatest(p_price_ore-p_purchase_price_ore,0),p_rate_bp);
  else raise exception 'INVALID_INPUT';
 end case;
end $$;

create function komisio_private.commission_invoice_vat(p_commission_ex_vat_ore bigint,p_rate_bp integer) returns bigint
language sql immutable set search_path='' as $$ select komisio_private.vat_on_net(p_commission_ex_vat_ore,p_rate_bp) $$;

revoke all on function komisio_private.vat_from_gross(bigint,integer),komisio_private.vat_on_net(bigint,integer),
 komisio_private.vat_for_line(text,bigint,bigint,bigint,integer),komisio_private.commission_invoice_vat(bigint,integer) from public,anon,authenticated;
