-- Operational reports retain gross sales and actual credits. Unknown accounting
-- is NULL, never a calculated zero or a new VAT model.
do $$ declare d text; needle text; signature text; begin
 d:=pg_get_functiondef('komisio_private.period_totals(uuid,timestamptz,timestamptz)'::regprocedure);
 d:=replace(d,'coalesce(sum(l.vat_ore),0)','case when bool_or(l.accounting_pending) then null else coalesce(sum(l.vat_ore),0) end');
 d:=replace(d,'coalesce(sum(l.commission_ore),0)','case when bool_or(l.accounting_pending) then null else coalesce(sum(l.commission_ore),0) end');
 d:=replace(d,'coalesce(sum(l.commission_vat_ore),0)','case when bool_or(l.accounting_pending) then null else coalesce(sum(l.commission_vat_ore),0) end');
 -- Credit is recognized at its effective ledger time, including expiry without
 -- inventory registration. Ordinary sale facts retain their existing behavior.
 d:=replace(d,'coalesce(sum(l.seller_credit_ore),0)','coalesce(sum(l.seller_credit_ore) filter(where l.guarantee_id is null),0)');
 d:=replace(d,'''sellerCreditOre'',t.credit','''sellerCreditOre'',t.credit+(select coalesce(sum(amount_ore),0) from public.seller_ledger_entries where tenant_id=p_tenant and kind=''credit_guarantee'' and occurred_at>=p_start and occurred_at<p_end)');
 d:=replace(d,'jsonb_object_agg(m.vat_mode,','jsonb_object_agg(coalesce(m.vat_mode,''pending''),');
 execute d;

 -- These totals are inputs to accounting documents. Their callers must not
 -- obtain partial financial totals through a direct/private call either.
 foreach signature in array array['komisio_private.day_close_totals_before_fees(uuid,date)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:='begin';
  execute replace(d,needle,needle||' perform komisio_private.require_guarantee_accounting_ready(p_tenant,p_date);');
 end loop;

 d:=pg_get_functiondef('public.chain_economy_summary(uuid,date,date)'::regprocedure);
 needle:='coalesce((s->''totals''->>k)::bigint,0)';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_CHAIN_TOTAL'; end if;
 execute replace(d,needle,'(s->''totals''->>k)::bigint');

 foreach signature in array array['public.stock_report_by_category(uuid,date,date,text)','public.stock_report_by_ownership(uuid,date,date,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('i.ownership, i.accepted_at' in d)=0 then raise exception 'UNEXPECTED_STOCK_OWNERSHIP'; end if;
  d:=replace(d,'i.ownership, i.accepted_at','komisio_private.item_operational_ownership(i.tenant_id,i.id) as ownership, i.accepted_at');
  d:=replace(d,'i.ownership=p_ownership','komisio_private.item_operational_ownership(i.tenant_id,i.id)=p_ownership');
  d:=replace(d,'coalesce(sum(margin) filter (where sold_in_period),0) as margin_sum',
   'case when bool_or(sold_in_period and margin is null) then null else coalesce(sum(margin) filter (where sold_in_period),0) end as margin_sum');
  d:=replace(d,'coalesce(sum(margin_sum),0)','case when bool_or(margin_sum is null) then null else coalesce(sum(margin_sum),0) end');
  d:=replace(d,'case when coalesce(sum(sold_gross),0)>0 then','case when not bool_or(margin_sum is null) and coalesce(sum(sold_gross),0)>0 then');
  execute d;
 end loop;
 d:=pg_get_functiondef('public.stock_assortment_report(uuid,text)'::regprocedure);
 if position('i.ownership=p_ownership' in d)=0 then raise exception 'UNEXPECTED_ASSORTMENT_OWNERSHIP'; end if;
 execute replace(d,'i.ownership=p_ownership','komisio_private.item_operational_ownership(i.tenant_id,i.id)=p_ownership');
end $$;

-- A settlement currently combines the seller account with commission/tax
-- figures. Keep the affected seller's document pending until those rules exist.
do $$ declare d text; needle text:='if p_corrects is not null then'; begin
 d:=pg_get_functiondef('public.issue_statement(uuid,uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_STATEMENT_ISSUE'; end if;
 execute replace(d,needle,'if exists(select 1 from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.seller_id=p_seller
   and e.kind=''credit_guarantee'' and e.occurred_at<p_to)
  or exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
   join public.items i on i.tenant_id=l.tenant_id and i.id=l.item_id
   where l.tenant_id=p_tenant and i.seller_id=p_seller and l.accounting_pending and s.occurred_at<p_to)
 then raise exception ''GUARANTEE_ACCOUNTING_PENDING''; end if; '||needle);
end $$;

-- Share a daily operational read between the overview and the brief. A day
-- with expiry credit and no sale must still appear, without double-counting.
create function komisio_private.operational_sales_days(p_tenant uuid,p_start timestamptz,p_end timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 with facts as (
  select (s.occurred_at at time zone 'Europe/Stockholm')::date as sale_day,s.id sale,l.price_ore gross,
   case when l.guarantee_id is null then l.seller_credit_ore else 0 end credit
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=p_start and s.occurred_at<p_end
  union all
  select (e.occurred_at at time zone 'Europe/Stockholm')::date,null::uuid,0,e.amount_ore
  from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.kind='credit_guarantee' and e.occurred_at>=p_start and e.occurred_at<p_end
 ), days as (select sale_day,count(distinct sale)::int n,sum(gross) gross,sum(credit) credit from facts group by sale_day)
 select coalesce(jsonb_agg(jsonb_build_object('date',sale_day,'salesCount',n,'grossOre',gross,'sellerCreditOre',credit) order by sale_day),'[]') from days;
$$;
revoke all on function komisio_private.operational_sales_days(uuid,timestamptz,timestamptz) from public,anon,authenticated;
do $$ declare d text; needle text:='select coalesce(sum(amount_ore),0)::bigint as available'; begin
 d:=pg_get_functiondef('komisio_private.economy_summary_before_seller_types(uuid,date,date)'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_ECONOMY_DAYS'; end if;
 execute replace(d,needle,'days:=komisio_private.operational_sales_days(p_tenant,p_start,p_end); '||needle);
end $$;

-- Seller-type reporting follows actual credits/reversals too; a customer return
-- on a guarantee does not reverse the seller's retained amount.
do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('komisio_private.seller_type_totals(uuid,date,date)'::regprocedure);
 d:=replace(d,'l.seller_credit_ore credit','case when l.guarantee_id is null then l.seller_credit_ore else 0 end credit');
 d:=replace(d,'l.ownership=''consignment''','(l.ownership=''consignment'' or l.guarantee_id is not null)');
 d:=replace(d,'r.refund_ore,l.seller_credit_ore,0','r.refund_ore,case when l.guarantee_id is null then l.seller_credit_ore else 0 end,0');
 d:=replace(d,'''vatOre'',sum(vat)','''vatOre'',case when bool_or(vat is null) then null else sum(vat) end');
 needle:='), totals as (';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SELLER_TYPE_TOTALS'; end if;
 execute replace(d,needle,'union all
  select s.seller_type,0,0,e.amount_ore,0,0,0 from public.seller_ledger_entries e
  join public.sellers s on s.tenant_id=e.tenant_id and s.id=e.seller_id
  where e.tenant_id=p_tenant and e.kind=''credit_guarantee''
   and e.occurred_at>=p_from::timestamp at time zone ''Europe/Stockholm''
   and e.occurred_at<(p_to+1)::timestamp at time zone ''Europe/Stockholm'' '||needle);
end $$;

-- Keep the private expiry clock defensive. Only the public worker selects the
-- real current instant; callers cannot supply a future instant to that RPC.
do $$ declare d text; needle text:='g:=komisio_private.central_guarantee(p_tenant,p_guarantee);'; begin
 d:=pg_get_functiondef('komisio_private.fulfill_due_guarantee(uuid,uuid,timestamptz)'::regprocedure);
 execute replace(d,needle,needle||' if p_at is null or not isfinite(p_at) then raise exception ''INVALID_INPUT''; end if;');
end $$;

-- Staff can sell central guaranteed goods through the same manual-sale entry.
-- Keep stale guarantees outside the currently designated central tenant closed.
do $$ declare d text; needle text:='where i.tenant_id=p_tenant'; begin
 d:=pg_get_functiondef('public.sale_item_search(uuid,text)'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SALE_SEARCH'; end if;
 execute replace(d,needle,needle||' and (not(i.terms ? ''externalGuarantee'') or exists(select 1 from public.platform_settings where central_app_tenant_id=p_tenant))');
end $$;
