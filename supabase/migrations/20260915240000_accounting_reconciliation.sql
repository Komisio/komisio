-- P3 accounting reconciliation: for every local day in a period, where the
-- books stand between the facts and Fortnox. A day is compared from the same
-- totals the day close uses (komisio_private.day_close_totals), so a close
-- whose facts moved is reported as stale, an export under an older map as
-- outdated, and a send by its recorded outcome. Read only; any member.
create function public.accounting_reconciliation(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d date; totals jsonb; latest public.day_closes; latest_map public.accounting_maps; e public.accounting_exports; s public.fortnox_voucher_sends;
 day_status text; rows jsonb:='[]'::jsonb; counts jsonb:='{}'::jsonb; active boolean;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_INPUT'; end if;
 select * into latest_map from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 for d in select generate_series(p_from,least(p_to,(now() at time zone 'Europe/Stockholm')::date),interval '1 day')::date loop
  totals:=komisio_private.day_close_totals(p_tenant,d);
  select * into latest from public.day_closes where tenant_id=p_tenant and close_date=d order by version desc limit 1;
  active:=(totals->>'salesCount')::int>0 or (totals->>'returnsCount')::int>0 or (totals->>'payoutsPaidOre')::bigint<>0 or (totals->>'creditReversedOre')::bigint<>0;
  if not active and not found then continue; end if;
  e:=null; s:=null;
  if not found then day_status:='no_close';
  elsif latest.sales_count<>(totals->>'salesCount')::int or latest.returns_count<>(totals->>'returnsCount')::int or latest.gross_ore<>(totals->>'grossOre')::bigint or latest.vat_ore<>(totals->>'vatOre')::bigint
   or latest.commission_ore<>(totals->>'commissionOre')::bigint or latest.commission_vat_ore<>(totals->>'commissionVatOre')::bigint or latest.seller_credit_ore<>(totals->>'sellerCreditOre')::bigint
   or latest.refunds_ore<>(totals->>'refundsOre')::bigint or latest.credit_reversed_ore<>(totals->>'creditReversedOre')::bigint or latest.payouts_paid_ore<>(totals->>'payoutsPaidOre')::bigint or latest.per_mode<>totals->'perMode' then day_status:='close_stale';
  else
   -- The export under the current map when there is one, else the newest.
   select * into e from public.accounting_exports where tenant_id=p_tenant and day_close_id=latest.id order by (latest_map.id is not null and map_id=latest_map.id) desc,created_at desc limit 1;
   if e.id is null then day_status:='not_exported';
   elsif latest_map.id is not null and e.map_id<>latest_map.id then day_status:='export_outdated';
   else
    -- The live send (at most one pending or sent per export) outranks failed ones.
    select * into s from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=e.id order by (status in ('pending','sent')) desc,created_at desc limit 1;
    day_status:=case when s.id is null then 'not_sent' when s.status='sent' then 'sent' when s.status='pending' then 'send_pending' else 'send_failed' end;
   end if;
  end if;
  rows:=rows||jsonb_build_object('date',d,'status',day_status,'salesCount',(totals->>'salesCount')::int,'grossOre',(totals->>'grossOre')::bigint,
   'close',case when latest.id is null then null else jsonb_build_object('id',latest.id,'version',latest.version,'generatedAt',latest.generated_at) end,
   'export',case when e.id is null then null else jsonb_build_object('id',e.id,'mapId',e.map_id,'createdAt',e.created_at) end,
   'send',case when s.id is null then null else jsonb_build_object('id',s.id,'status',s.status,'voucherSeries',s.voucher_series,'voucherNumber',s.voucher_number,'errorCode',s.error_code,'createdAt',s.created_at) end);
  counts:=counts||jsonb_build_object(day_status,coalesce((counts->>day_status)::int,0)+1);
 end loop;
 return jsonb_build_object('from',p_from,'to',p_to,'timeZone','Europe/Stockholm','currency',komisio_private.store_currency(p_tenant),'mapVersion',coalesce(latest_map.version,0),'days',rows,'counts',counts);
end $$;
revoke all on function public.accounting_reconciliation(uuid,date,date) from public,anon;
grant execute on function public.accounting_reconciliation(uuid,date,date) to authenticated;
