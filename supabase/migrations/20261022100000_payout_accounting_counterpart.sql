-- #561: a paid payout needs two explicitly mapped postings. Existing frozen
-- exports and mappings are evidence and are never rewritten by this migration.
create function komisio_private.payout_mapping_complete(m jsonb, allow_exclusion boolean default false) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(
  (allow_exclusion and m->'payoutsPaidOre' ? 'excludeReason' and m->'payoutsPaidCounterpartOre' ? 'excludeReason')
  or (
   m->'payoutsPaidOre' ?& array['account','side']
   and m->'payoutsPaidCounterpartOre' ?& array['account','side']
   and m->'payoutsPaidOre'->>'account'<>m->'payoutsPaidCounterpartOre'->>'account'
   and m->'payoutsPaidOre'->>'side' in ('debit','credit')
   and m->'payoutsPaidCounterpartOre'->>'side' in ('debit','credit')
   and m->'payoutsPaidOre'->>'side'<>m->'payoutsPaidCounterpartOre'->>'side'
  ),false)
$$;
revoke all on function komisio_private.payout_mapping_complete(jsonb,boolean) from public,anon,authenticated;

-- Keep the exact existing amount projection, including fee treatment. The new
-- key carries the same paid amount; it does not add another payout fact.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('komisio_private.accounting_keys()'::regprocedure);
 execute replace(definition,'FUNCTION komisio_private.accounting_keys(', 'FUNCTION komisio_private.accounting_keys_before_payouts(');
 definition:=pg_get_functiondef('komisio_private.voucher_for_before_fees(public.day_closes,jsonb)'::regprocedure);
 if position('when ''payoutsPaidOre'' then p_close.payouts_paid_ore' in definition)=0 then
  raise exception 'UNEXPECTED_PAYOUT_PROJECTION';
 end if;
 execute replace(definition,'when ''payoutsPaidOre'' then p_close.payouts_paid_ore',
  'when ''payoutsPaidOre'' then p_close.payouts_paid_ore when ''payoutsPaidCounterpartOre'' then p_close.payouts_paid_ore');
 execute replace(pg_get_functiondef('komisio_private.valid_accounting_map(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_accounting_map(', 'FUNCTION komisio_private.valid_accounting_map_before_payouts(');
 execute replace(pg_get_functiondef('komisio_private.valid_economic_map(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_economic_map(', 'FUNCTION komisio_private.valid_economic_map_before_payouts(');
 execute replace(pg_get_functiondef('komisio_private.economic_voucher_for(public.day_closes,jsonb)'::regprocedure),
  'FUNCTION komisio_private.economic_voucher_for(', 'FUNCTION komisio_private.economic_voucher_for_before_payouts(');
end $$;
revoke all on function komisio_private.accounting_keys_before_payouts(),
 komisio_private.valid_accounting_map_before_payouts(jsonb),
 komisio_private.valid_economic_map_before_payouts(jsonb),
 komisio_private.economic_voucher_for_before_payouts(public.day_closes,jsonb) from public,anon,authenticated;

create or replace function komisio_private.accounting_keys() returns text[]
language sql immutable set search_path='' as $$
 select komisio_private.accounting_keys_before_payouts()||array['payoutsPaidCounterpartOre']
$$;

-- Legacy single-key maps remain readable. A new counterpart must be a complete
-- pair; a nonzero paid total under a legacy map is refused by the projection.
create or replace function komisio_private.valid_accounting_map(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select komisio_private.valid_accounting_map_before_payouts(value)
  and (not(value ? 'payoutsPaidCounterpartOre') or komisio_private.payout_mapping_complete(value))
$$;
create or replace function komisio_private.valid_economic_map(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select komisio_private.valid_economic_map_before_payouts(value)
  and (not(value ? 'payoutsPaidCounterpartOre') or komisio_private.payout_mapping_complete(value,true))
$$;

create or replace function komisio_private.voucher_for(p_close public.day_closes,p_map jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 result:=komisio_private.voucher_for_before_fees(p_close,p_map);
 if exists(select 1 from jsonb_array_elements_text(result->'unmapped') k where k like 'mode:consignment_fee%')
  or (p_close.payouts_paid_ore<>0 and not komisio_private.payout_mapping_complete(p_map)) then
  result:=jsonb_set(result,'{balanced}','false');
 end if;
 return result;
end $$;

create or replace function komisio_private.economic_voucher_for(c public.day_closes,m jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 result:=komisio_private.economic_voucher_for_before_payouts(c,m);
 if c.payouts_paid_ore<>0 and not komisio_private.payout_mapping_complete(m,true) then
  -- The delta preview uses unmapped keys as its completeness gate, so preserve
  -- this refusal even if unrelated postings happen to balance the bad pair.
  result:=result||jsonb_build_object('balanced',false,'unmapped',
   (select jsonb_agg(distinct k order by k) from jsonb_array_elements_text(
    result->'unmapped'||'["payoutsPaidOre","payoutsPaidCounterpartOre"]'::jsonb) k));
 end if;
 return result;
end $$;
