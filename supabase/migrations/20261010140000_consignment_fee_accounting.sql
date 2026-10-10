-- Separate payments are evidenced against the external POS receipt. Balance
-- deductions and their corrections need their own explicitly configured accounts.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.day_close_totals(uuid,date)'::regprocedure),
  'FUNCTION komisio_private.day_close_totals(', 'FUNCTION komisio_private.day_close_totals_before_fees(');
 execute replace(pg_get_functiondef('komisio_private.accounting_keys()'::regprocedure),
  'FUNCTION komisio_private.accounting_keys(', 'FUNCTION komisio_private.accounting_keys_before_fees(');
 execute replace(pg_get_functiondef('komisio_private.voucher_for(public.day_closes,jsonb)'::regprocedure),
  'FUNCTION komisio_private.voucher_for(', 'FUNCTION komisio_private.voucher_for_before_fees(');
end $$;
revoke all on function komisio_private.day_close_totals_before_fees(uuid,date),komisio_private.accounting_keys_before_fees(),
 komisio_private.voucher_for_before_fees(public.day_closes,jsonb) from public,anon,authenticated;
create or replace function komisio_private.day_close_totals(p_tenant uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; modes jsonb; first_at timestamptz:=p_date::timestamp at time zone 'Europe/Stockholm'; last_at timestamptz:=(p_date+1)::timestamp at time zone 'Europe/Stockholm';
begin
 result:=komisio_private.day_close_totals_before_fees(p_tenant,p_date);
 select coalesce(jsonb_object_agg(x.kind,jsonb_build_object('lines',x.n,'grossOre',x.gross,'netOre',x.net,'vatOre',x.vat)),'{}'::jsonb) into modes
 from (
  select kind,count(*) n,sum(gross_ore) gross,sum(net_ore) net,sum(vat_ore) vat from (
   select 'consignment_fee'::text kind,f.gross_ore,f.net_ore,f.vat_ore from public.consignment_fees f
    where f.tenant_id=p_tenant and f.collection='balance' and f.recorded_at>=first_at and f.recorded_at<last_at
   union all
   select 'consignment_fee_reversal',f.gross_ore,f.net_ore,f.vat_ore from public.consignment_fee_events e join public.consignment_fees f on f.tenant_id=e.tenant_id and f.id=e.fee_id
    where e.tenant_id=p_tenant and e.kind='reversed' and f.collection='balance' and e.occurred_at>=first_at and e.occurred_at<last_at
  ) facts group by kind
 ) x;
 return jsonb_set(result,'{perMode}',(result->'perMode')||modes);
end $$;
create or replace function komisio_private.accounting_keys() returns text[]
language sql immutable set search_path='' as $$
 select komisio_private.accounting_keys_before_fees()||array[
  'mode:consignment_fee:grossOre','mode:consignment_fee:netOre','mode:consignment_fee:vatOre',
  'mode:consignment_fee_reversal:grossOre','mode:consignment_fee_reversal:netOre','mode:consignment_fee_reversal:vatOre']
$$;
create or replace function komisio_private.voucher_for(p_close public.day_closes,p_map jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 result:=komisio_private.voucher_for_before_fees(p_close,p_map);
 if exists(select 1 from jsonb_array_elements_text(result->'unmapped') k where k like 'mode:consignment_fee%') then
  result:=jsonb_set(result,'{balanced}','false');
 end if;
 return result;
end $$;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.accounting_reconciliation(uuid,date,date)'::regprocedure);
 if position('active:=' in definition)=0 then raise exception 'UNEXPECTED_RECONCILIATION_DEFINITION'; end if;
 definition:=replace(definition,'active:=','active:=(totals->''perMode'') ?| array[''consignment_fee'',''consignment_fee_reversal''] or ');
 execute definition;
end $$;

-- A payout reservation cannot skip fees due since its request was created.
-- Existing approved reservations remain intact; fees may create a separate debt.
create function komisio_private.consignment_before_payout() returns trigger
language plpgsql security definer set search_path='' as $$
declare p record; available numeric;
begin
 if new.kind<>'payout_reserved' then return new; end if;
 for p in select id from public.seller_consignment_periods where tenant_id=new.tenant_id and seller_id=new.seller_id order by started_at,id loop
  perform komisio_private.accrue_consignment_fees(p.id,now(),new.recorded_by);
 end loop;
 select coalesce(sum(amount_ore),0) into available from public.seller_ledger_entries where tenant_id=new.tenant_id and seller_id=new.seller_id;
 if available < -new.amount_ore then raise exception 'PAYOUT_EXCEEDS_BALANCE'; end if;
 return new;
end $$;
revoke all on function komisio_private.consignment_before_payout() from public,anon,authenticated;
create trigger consignment_before_payout before insert on public.seller_ledger_entries for each row execute function komisio_private.consignment_before_payout();
