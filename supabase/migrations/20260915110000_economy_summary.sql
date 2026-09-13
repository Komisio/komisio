-- P3 economy overview: one read model for any period, computed from the same
-- facts and with the same sums as the day close (completed sale lines,
-- returns, credit reversals, paid payouts), plus the store's current
-- liability to sellers and the open payouts. Nothing is written; a brief a
-- person or an agent writes is a rendering of this read.
create function komisio_private.period_totals(p_tenant uuid,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t record; modes jsonb;
begin
 select count(distinct l.sale_id)::int as sales_count,count(*)::int as lines_count,coalesce(sum(l.price_ore),0)::bigint as gross,coalesce(sum(l.vat_ore),0)::bigint as vat,
  coalesce(sum(l.commission_ore),0)::bigint as commission,coalesce(sum(l.commission_vat_ore),0)::bigint as commission_vat,coalesce(sum(l.seller_credit_ore),0)::bigint as credit
 into t from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
 where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=p_start and s.occurred_at<p_end;
 select coalesce(jsonb_object_agg(m.vat_mode,jsonb_build_object('lines',m.n,'grossOre',m.gross,'vatOre',m.vat,'netOre',m.gross-m.vat)),'{}'::jsonb) into modes
 from (select l.vat_mode,count(*)::int n,sum(l.price_ore)::bigint gross,sum(l.vat_ore)::bigint vat
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=p_start and s.occurred_at<p_end group by l.vat_mode) m;
 return jsonb_build_object(
  'salesCount',t.sales_count,'linesCount',t.lines_count,'grossOre',t.gross,'vatOre',t.vat,'netOre',t.gross-t.vat,'commissionOre',t.commission,'commissionVatOre',t.commission_vat,'sellerCreditOre',t.credit,
  'returnsCount',(select count(*)::int from public.sale_returns r where r.tenant_id=p_tenant and r.occurred_at>=p_start and r.occurred_at<p_end),
  'refundsOre',(select coalesce(sum(r.refund_ore),0)::bigint from public.sale_returns r where r.tenant_id=p_tenant and r.occurred_at>=p_start and r.occurred_at<p_end),
  'creditReversedOre',(select coalesce(-sum(e.amount_ore),0)::bigint from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.kind='credit_reversal' and e.occurred_at>=p_start and e.occurred_at<p_end),
  'payoutsPaidCount',(select count(*)::int from public.payouts p where p.tenant_id=p_tenant and p.status='paid' and p.paid_at>=p_start and p.paid_at<p_end),
  'payoutsPaidOre',(select coalesce(sum(p.amount_ore),0)::bigint from public.payouts p where p.tenant_id=p_tenant and p.status='paid' and p.paid_at>=p_start and p.paid_at<p_end),
  'perMode',modes);
end $$;
revoke all on function komisio_private.period_totals(uuid,timestamptz,timestamptz) from public,anon,authenticated;

-- Inclusive local dates (Europe/Stockholm), at most one year. Members of any
-- role may read; the numbers are the store's own.
create function public.economy_summary(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p_start timestamptz; p_end timestamptz; totals jsonb; days jsonb; liability record; open_payouts record;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_INPUT'; end if;
 p_start:=(p_from::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 p_end:=((p_to+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 totals:=komisio_private.period_totals(p_tenant,p_start,p_end);
 select coalesce(jsonb_agg(jsonb_build_object('date',d.sale_day,'salesCount',d.n,'grossOre',d.gross,'sellerCreditOre',d.credit) order by d.sale_day),'[]'::jsonb) into days
 from (select (s.occurred_at at time zone 'Europe/Stockholm')::date as sale_day,count(distinct s.id)::int as n,sum(l.price_ore)::bigint gross,sum(l.seller_credit_ore)::bigint credit
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=p_start and s.occurred_at<p_end group by 1) d;
 select coalesce(sum(amount_ore),0)::bigint as available,coalesce(-sum(amount_ore) filter (where kind in ('payout_reserved','payout_released')),0)::bigint as reserved,
  count(distinct seller_id) filter (where amount_ore<>0)::int as sellers
 into liability from public.seller_ledger_entries where tenant_id=p_tenant;
 select count(*)::int as n,coalesce(sum(amount_ore),0)::bigint as total into open_payouts from public.payouts where tenant_id=p_tenant and status in ('requested','approved');
 return jsonb_build_object('from',p_from,'to',p_to,'timeZone','Europe/Stockholm','totals',totals,'days',days,
  'liability',jsonb_build_object('availableOre',liability.available,'reservedOre',liability.reserved,'owedOre',liability.available+liability.reserved,'sellersWithEntries',liability.sellers),
  'openPayouts',jsonb_build_object('count',open_payouts.n,'amountOre',open_payouts.total));
end $$;
revoke all on function public.economy_summary(uuid,date,date) from public,anon;
grant execute on function public.economy_summary(uuid,date,date) to authenticated;
