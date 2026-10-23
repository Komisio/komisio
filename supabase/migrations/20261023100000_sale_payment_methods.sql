-- #571: immutable tender evidence and frozen, per-method day-close contributions.
alter table public.sales add column payment_method text not null default 'unspecified'
 check(payment_method in ('unspecified','card','cash','mobilepay','swish','other'));
alter table public.day_closes add column payment_totals jsonb not null default '{}' check(jsonb_typeof(payment_totals)='object');
alter table public.accounting_exports add column excluded jsonb not null default '{}' check(jsonb_typeof(excluded)='object');
do $$ declare definition text; signature regprocedure; begin
 definition:=pg_get_functiondef('komisio_private.record_sale_core(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb)'::regprocedure);
 if position('recorded_by,staff_note)' in definition)=0 then raise exception 'UNEXPECTED_SALE_CORE'; end if;
 definition:=replace(definition,'if p_currency<>',
  'if p_reference ? ''paymentMethod'' and (jsonb_typeof(p_reference->''paymentMethod'')<>''string'' or p_reference->>''paymentMethod'' not in (''unspecified'',''card'',''cash'',''mobilepay'',''swish'',''other'')) then raise exception ''INVALID_INPUT''; end if; if p_currency<>');
 definition:=replace(definition,'existing_lines is distinct from p_lines',
  'existing_lines is distinct from p_lines or prior.payment_method is distinct from coalesce(p_reference->>''paymentMethod'',''unspecified'')');
 definition:=replace(definition,'recorded_by,staff_note)','recorded_by,payment_method,staff_note)');
 definition:=replace(definition,'total,p_reference,uid,','total,p_reference,uid,coalesce(p_reference->>''paymentMethod'',''unspecified''),');
 execute definition;
 foreach signature in array array['public.sales_page(uuid,text,text,text,integer)'::regprocedure,'public.sale_detail(uuid,uuid)'::regprocedure] loop
  execute replace(pg_get_functiondef(signature),'s.recorded_at,s.staff_note','s.recorded_at,s.staff_note,s.payment_method');
 end loop;
end $$;

create function komisio_private.day_payment_totals(p_tenant uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 with facts as (
  select s.payment_method method,l.vat_mode,l.price_ore gross,l.vat_ore vat,l.commission_ore commission,
   l.commission_vat_ore commission_vat,l.seller_credit_ore credit,0::bigint refunds,0::bigint reversed,1 n
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where s.tenant_id=p_tenant and s.status='completed' and s.payment_method<>'unspecified'
   and s.occurred_at>=p_date::timestamp at time zone 'Europe/Stockholm'
   and s.occurred_at<(p_date+1)::timestamp at time zone 'Europe/Stockholm'
  union all
  select s.payment_method,null,0,0,0,0,0,r.refund_ore,l.seller_credit_ore,0
  from public.sale_returns r join public.sale_lines l on l.tenant_id=r.tenant_id and l.id=r.sale_line_id
  join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where r.tenant_id=p_tenant and s.payment_method<>'unspecified'
   and r.occurred_at>=p_date::timestamp at time zone 'Europe/Stockholm'
   and r.occurred_at<(p_date+1)::timestamp at time zone 'Europe/Stockholm'
 ), modes as (
  select method,vat_mode,count(*) n,sum(gross) gross,sum(vat) vat from facts where n=1 group by method,vat_mode
 ), totals as (
  select method,jsonb_build_object('grossOre',sum(gross),'vatOre',sum(vat),'commissionOre',sum(commission),
   'commissionVatOre',sum(commission_vat),'sellerCreditOre',sum(credit),'refundsOre',sum(refunds),'creditReversedOre',sum(reversed),
   'perMode',coalesce((select jsonb_object_agg(m.vat_mode,jsonb_build_object('lines',m.n,'grossOre',m.gross,'netOre',m.gross-m.vat,'vatOre',m.vat)) from modes m where m.method=f.method),'{}')) body
  from facts f group by method
 ) select coalesce(jsonb_object_agg(method,body),'{}') from totals
$$;
revoke all on function komisio_private.day_payment_totals(uuid,date) from public,anon,authenticated;
do $$ declare definition text; begin
 execute replace(pg_get_functiondef('komisio_private.day_close_totals(uuid,date)'::regprocedure),'FUNCTION komisio_private.day_close_totals(', 'FUNCTION komisio_private.day_close_totals_before_payments(');
 definition:=pg_get_functiondef('public.generate_day_close(uuid,uuid,date)'::regprocedure);
 if position('generated_by,payout_sources)' in definition)=0 or position('if same and ' in definition)=0 then raise exception 'UNEXPECTED_PAYMENT_CLOSE'; end if;
 definition:=replace(definition,'if same and ', 'if same and latest.payment_totals=totals->''paymentTotals'' and ');
 definition:=replace(definition,'generated_by,payout_sources)','generated_by,payment_totals,payout_sources)');
 definition:=replace(definition,'uid,komisio_private.paid_payout_sources','uid,totals->''paymentTotals'',komisio_private.paid_payout_sources');
 execute definition;
 execute replace(pg_get_functiondef('public.day_close_page(uuid)'::regprocedure),'d.per_mode,d.generated_at','d.per_mode,d.generated_at,d.payment_totals');
end $$;
revoke all on function komisio_private.day_close_totals_before_payments(uuid,date) from public,anon,authenticated;
create or replace function komisio_private.day_close_totals(p_tenant uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 select komisio_private.day_close_totals_before_payments(p_tenant,p_date)||jsonb_build_object('paymentTotals',komisio_private.day_payment_totals(p_tenant,p_date))
$$;

-- Keep historical projections intact. New payment rows are appended after the
-- existing selective amount projection; old closes have no payment buckets.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.accounting_keys()'::regprocedure),'FUNCTION komisio_private.accounting_keys(', 'FUNCTION komisio_private.accounting_keys_before_payments(');
 execute replace(pg_get_functiondef('komisio_private.voucher_for(public.day_closes,jsonb)'::regprocedure),'FUNCTION komisio_private.voucher_for(', 'FUNCTION komisio_private.voucher_for_before_payments(');
 execute replace(pg_get_functiondef('komisio_private.economic_voucher_for(public.day_closes,jsonb)'::regprocedure),'FUNCTION komisio_private.economic_voucher_for(', 'FUNCTION komisio_private.economic_voucher_for_before_payments(');
 execute replace(pg_get_functiondef('komisio_private.valid_accounting_map(jsonb)'::regprocedure),'FUNCTION komisio_private.valid_accounting_map(', 'FUNCTION komisio_private.valid_accounting_map_before_payments(');
 execute replace(pg_get_functiondef('komisio_private.valid_economic_map(jsonb)'::regprocedure),'FUNCTION komisio_private.valid_economic_map(', 'FUNCTION komisio_private.valid_economic_map_before_payments(');
 -- Unknown appended keys have no legacy amount; never manufacture null lines.
 execute replace(pg_get_functiondef('komisio_private.voucher_for_before_fees(public.day_closes,jsonb)'::regprocedure),'if amount=0 then','if coalesce(amount,0)=0 then');
end $$;
revoke all on function komisio_private.accounting_keys_before_payments(),komisio_private.voucher_for_before_payments(public.day_closes,jsonb),
 komisio_private.valid_accounting_map_before_payments(jsonb),komisio_private.valid_economic_map_before_payments(jsonb),komisio_private.economic_voucher_for_before_payments(public.day_closes,jsonb) from public,anon,authenticated;
create or replace function komisio_private.accounting_keys() returns text[]
language sql immutable set search_path='' as $$
 select komisio_private.accounting_keys_before_payments()||array(select 'payment:'||method||':'||amount
  from unnest(array['card','cash','mobilepay','swish','other']) method cross join unnest(array['grossOre','refundsOre']) amount)
$$;
create function komisio_private.payment_exclusions_complete(m jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare method text; g jsonb; r jsonb;
begin
 foreach method in array array['card','cash','mobilepay','swish','other'] loop
  g:=m->('payment:'||method||':grossOre'); r:=m->('payment:'||method||':refundsOre');
  if coalesce(g ? 'excludeReason',false) or coalesce(r ? 'excludeReason',false) then
   if g is null or r is null or g is distinct from r or jsonb_typeof(g->'excludeReason')<>'string'
    or length(trim(g->>'excludeReason')) not between 1 and 500 or (g-'excludeReason')<>'{}' then return false; end if;
  end if;
 end loop;
 return true;
end $$;
revoke all on function komisio_private.payment_exclusions_complete(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_accounting_map(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; posted jsonb:=value;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 for k,v in select * from jsonb_each(value) loop
  if v ? 'excludeReason' then
   if k not like 'payment:%' or not(k=any(komisio_private.accounting_keys())) then return false; end if;
   posted:=posted-k;
  end if;
 end loop;
 return komisio_private.payment_exclusions_complete(value) and komisio_private.valid_accounting_map_before_payments(posted);
end $$;
create or replace function komisio_private.valid_economic_map(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select komisio_private.valid_economic_map_before_payments(value) and komisio_private.payment_exclusions_complete(value)
$$;

-- Exclusion removes the method's whole existing contribution, not just cash.
-- Independent fees and payout facts are deliberately left in the close.
create function komisio_private.payment_amounts(c public.day_closes,m jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare adjusted public.day_closes:=c; method text; bucket jsonb; mode text; amounts jsonb; field text; k text;
 projected jsonb:='{}'; raw jsonb; line jsonb; result jsonb:='{}'; excluded jsonb:='{}'; amount bigint;
begin
 for method,bucket in select * from jsonb_each(c.payment_totals) loop
  adjusted.gross_ore:=adjusted.gross_ore-(bucket->>'grossOre')::bigint;
  adjusted.refunds_ore:=adjusted.refunds_ore-(bucket->>'refundsOre')::bigint;
  if m->('payment:'||method||':grossOre') ? 'excludeReason' then
   adjusted.vat_ore:=adjusted.vat_ore-(bucket->>'vatOre')::bigint;
   adjusted.commission_ore:=adjusted.commission_ore-(bucket->>'commissionOre')::bigint;
   adjusted.commission_vat_ore:=adjusted.commission_vat_ore-(bucket->>'commissionVatOre')::bigint;
   adjusted.seller_credit_ore:=adjusted.seller_credit_ore-(bucket->>'sellerCreditOre')::bigint;
   adjusted.credit_reversed_ore:=adjusted.credit_reversed_ore-(bucket->>'creditReversedOre')::bigint;
   for mode,amounts in select * from jsonb_each(bucket->'perMode') loop
    foreach field in array array['lines','grossOre','netOre','vatOre'] loop
     adjusted.per_mode:=jsonb_set(adjusted.per_mode,array[mode,field],to_jsonb((adjusted.per_mode->mode->>field)::bigint-(amounts->>field)::bigint));
    end loop;
   end loop;
   foreach field in array array['grossOre','refundsOre'] loop
    amount:=(bucket->>field)::bigint;
    if amount<>0 then excluded:=excluded||jsonb_build_object('payment:'||method||':'||field,jsonb_build_object('amountOre',amount,'reason',m->('payment:'||method||':grossOre')->>'excludeReason')); end if;
   end loop;
  else
   foreach field in array array['grossOre','refundsOre'] loop
    amount:=(bucket->>field)::bigint;
    if amount<>0 then result:=result||jsonb_build_object('payment:'||method||':'||field,amount); end if;
   end loop;
  end if;
 end loop;
 foreach k in array komisio_private.accounting_keys() loop
  projected:=projected||jsonb_build_object(k,jsonb_build_object('account','1000','side','debit'));
 end loop;
 raw:=komisio_private.voucher_for_before_payments(adjusted,projected);
 for line in select * from jsonb_array_elements(raw->'lines') loop
  result:=result||jsonb_build_object(line->>'key',line->'amountOre');
 end loop;
 return jsonb_build_object('amounts',result,'excluded',excluded);
end $$;
revoke all on function komisio_private.payment_amounts(public.day_closes,jsonb) from public,anon,authenticated;

create function komisio_private.payment_voucher(c public.day_closes,m jsonb,economic boolean) returns jsonb
language plpgsql immutable set search_path='' as $$
declare raw jsonb:=komisio_private.payment_amounts(c,m); k text; amount jsonb; entry jsonb; line jsonb;
 lines jsonb:='[]'; missing jsonb:='[]'; excluded jsonb:=raw->'excluded'; debit bigint:=0; credit bigint:=0; blocked boolean:=false;
begin
 for k,amount in select * from jsonb_each(raw->'amounts') order by key loop
  entry:=m->k;
  if entry is null then
   missing:=missing||to_jsonb(k);
   if economic or k like 'payment:%' or k like 'mode:consignment_fee%' then blocked:=true; end if;
  elsif entry ? 'excludeReason' then
   excluded:=excluded||jsonb_build_object(k,jsonb_build_object('amountOre',amount,'reason',entry->>'excludeReason'));
  else
   line:=jsonb_build_object('key',k,'account',entry->>'account','side',entry->>'side','amountOre',amount);
   if economic then line:=line||jsonb_build_object('vatCode',entry->>'vatCode'); end if;
   lines:=lines||line;
   if entry->>'side'='debit' then debit:=debit+amount::text::bigint; else credit:=credit+amount::text::bigint; end if;
  end if;
 end loop;
 if c.payouts_paid_ore<>0 and not komisio_private.payout_mapping_complete(m,economic) then
  blocked:=true; missing:=missing||'["payoutsPaidOre","payoutsPaidCounterpartOre"]'::jsonb;
 end if;
 return jsonb_build_object('lines',lines,'excluded',excluded,'unmapped',missing,'debitOre',debit,'creditOre',credit,
  'balanced',not blocked and komisio_private.payment_exclusions_complete(m) and debit=credit and jsonb_array_length(lines)>0);
end $$;
revoke all on function komisio_private.payment_voucher(public.day_closes,jsonb,boolean) from public,anon,authenticated;
create or replace function komisio_private.voucher_for(p_close public.day_closes,p_map jsonb) returns jsonb
language sql immutable set search_path='' as $$ select case when p_close.payment_totals='{}' then komisio_private.voucher_for_before_payments(p_close,p_map)||'{"excluded":{}}'::jsonb else komisio_private.payment_voucher(p_close,p_map,false) end $$;
create or replace function komisio_private.economic_voucher_for(c public.day_closes,m jsonb) returns jsonb
language sql immutable set search_path='' as $$ select case when c.payment_totals='{}' then komisio_private.economic_voucher_for_before_payments(c,m) else komisio_private.payment_voucher(c,m,true) end $$;

-- Freeze the exclusion evidence with the export, just as e-conomic already does.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.export_day_close(uuid,uuid,uuid)'::regprocedure);
 if position('credit_ore,created_by)' in definition)=0 then raise exception 'UNEXPECTED_PAYMENT_EXPORT'; end if;
 definition:=replace(definition,'credit_ore,created_by)','credit_ore,created_by,excluded)');
 definition:=replace(definition,'(v->>''creditOre'')::bigint,uid);','(v->>''creditOre'')::bigint,uid,v->''excluded'');');
 execute definition;
end $$;
