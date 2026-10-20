begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Matched to lib/platform/currencies.ts by the unit parity guard.
create temp table matrix_currencies as
select jsonb_array_elements_text('["SEK","NOK","DKK","EUR","USD"]'::jsonb) as currency;
grant select on matrix_currencies to authenticated;
insert into auth.users(id,email,email_confirmed_at)
values ('f5240000-0000-4000-8000-000000000001','matrix-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f5240000-0000-4000-8000-000000000001","role":"authenticated"}';

create function pg_temp.currency_flow(cur text) returns setof text language plpgsql as $$
declare t uuid; seller uuid; agreement uuid; bag uuid; draft uuid:=gen_random_uuid();
 i uuid:=gen_random_uuid(); exp uuid; cfg uuid; rate numeric; other text; line jsonb; sale jsonb;
 receipt uuid:=gen_random_uuid(); page uuid:=gen_random_uuid(); prior text; next_cursor text;
 refund jsonb; exported jsonb; merchant uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid();
 title text:='Läderjacka – blå æøåäöÆØÅÄÖ ß é ñ ł 🧥';
begin
 t:=public.create_tenant_with_currency('Currency matrix','matrix-'||lower(cur),gen_random_uuid(),cur);
 perform set_config('test.matrix_policy',(public.current_store_policy(t)->'policy')::text,true);
 seller:=public.register_seller(t,gen_random_uuid(),'Synthetic seller','matrix-seller@example.test','');
 agreement:=public.publish_seller_agreement(t,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false);
 perform public.record_agreement_evidence(t,gen_random_uuid(),seller,agreement,'Synthetic paper');
 bag:=public.receive_bag_with_agreement(t,gen_random_uuid(),seller,'',agreement);
 perform pg_temp.prepare_bag_reception(t,gen_random_uuid(),bag,draft,0,title,'Jackets','Good');
 perform public.accept_item(t,i,'reception_review',draft,1,12345);
 foreach rate in array array[0,13.5,19,21,22,24,25,25.5]::numeric[] loop
  perform public.publish_store_policy(t,gen_random_uuid(),(public.current_store_policy(t)->>'id')::uuid,
   (public.current_store_policy(t)->'policy')||jsonb_build_object('vatModeConsignmentPrivate','consignment_margin','vatRatePercent',rate));
  perform public.publish_zettle_catalog_config(t,gen_random_uuid(),cfg,jsonb_build_object('consignment_margin',rate));
  select id into cfg from public.zettle_catalog_configs where tenant_id=t order by revision desc limit 1;
  exp:=public.prepare_zettle_product(t,i);
  select payload into exported from public.zettle_product_exports where id=exp;
  return next is(exported->'variants'->0->'price',jsonb_build_object('amount',12345,'currencyId',cur),'exact export amount/currency '||cur||' VAT '||rate);
  return next is((exported->>'vatPercentage')::numeric,rate,'published decimal VAT survives export '||cur||' '||rate);
  return next is(exported->>'name',title,'Unicode export title '||cur||' '||rate);
 end loop;
 perform public.correct_item_attribute(t,gen_random_uuid(),i,'description',repeat('a',119)||'🧥extra','Boundary test');
 exp:=public.prepare_zettle_product(t,i);
 select payload into exported from public.zettle_product_exports where id=exp;
 return next is(exported->>'name',repeat('a',119)||'🧥','SQL truncates at 120 code points, not UTF-16 units');
 perform public.finish_zettle_product(t,exp,'synced',null);
 perform public.enable_zettle_pull(t,merchant);
 perform public.claim_zettle_stock(t,intent,exp,merchant,jsonb_build_object('STORE',gen_random_uuid(),'SUPPLIER',gen_random_uuid(),'SOLD',gen_random_uuid(),'BIN',gen_random_uuid()));
 perform public.finish_zettle_stock(t,intent,'initialized',null);
 return next is(public.paypal_item_status(t,array[i])->0->>'status','synced','confirmed catalog and initial stock in '||cur);
 line:=jsonb_build_object('lineNo',1,'reference',null,'labelConflict',false,'description',title,'priceOre',12345,
  'productUuid',exported->>'uuid','variantUuid',exported->'variants'->0->>'uuid');
 sale:=jsonb_build_object('externalId',receipt,'occurredAt',now(),'currency',cur,'amountOre',12345,'blockedReason',null,'lines',jsonb_build_array(line));
 -- Foreign receipts are retained for review, never converted or proposed as sales.
 for other in select currency from matrix_currencies where currency<>cur loop
  next_cursor:='held-'||other;
  perform public.record_zettle_page(t,gen_random_uuid(),prior,next_cursor,jsonb_build_array(sale||jsonb_build_object('externalId',gen_random_uuid(),'currency',other,'blockedReason','currency')));
  prior:=next_cursor;
  return next is((select count(*) from public.sales where tenant_id=t),0::bigint,'foreign '||other||' creates no '||cur||' sale');
  return next is((select count(*) from public.seller_ledger_entries where tenant_id=t),0::bigint,'foreign receipt creates no credit');
  return next is((select count(*) from public.pending_operations where tenant_id=t),0::bigint,'foreign receipt creates no pending operation');
 end loop;
 perform public.record_zettle_page(t,page,prior,'sale',jsonb_build_array(sale));
 perform public.record_zettle_page(t,page,prior,'sale',jsonb_build_array(sale));
 return next is((select count(*) from public.sales where tenant_id=t and currency=cur),1::bigint,'one matching '||cur||' sale, including replay');
 return next is((select sum(price_ore) from public.sale_lines where tenant_id=t),12345::numeric,'exact sale line minor units');
 return next is((select count(*) from public.seller_ledger_entries where tenant_id=t and kind='credit_sale'),1::bigint,'sale credits once');
 refund:=sale||jsonb_build_object('externalId',gen_random_uuid(),'refundOf',receipt,'amountOre',-12345,'blockedReason','refund');
 page:=gen_random_uuid();
 perform public.record_zettle_page(t,page,'sale','refund',jsonb_build_array(refund));
 perform public.record_zettle_page(t,page,'sale','refund',jsonb_build_array(refund));
 return next is((select count(*) from public.sale_returns where tenant_id=t),1::bigint,'one reconciled '||cur||' refund, including replay');
 return next is((select sum(amount_ore) from public.seller_ledger_entries where tenant_id=t),0::numeric,'refund reverses exact seller credit');
 return next is((select count(*) from public.seller_ledger_entries where tenant_id=t and kind='credit_reversal'),1::bigint,'refund cannot reverse twice');
end $$;
select result from matrix_currencies cross join lateral pg_temp.currency_flow(currency) as flow(result);
reset role;

-- Exercise the current deployed validators, not historical migration text.
create function pg_temp.validator_parity(cur text, supported boolean) returns setof text language plpgsql as $$
declare receipt jsonb; review jsonb; constraint_row record; accepted boolean;
begin
 return next is(komisio_private.valid_store_policy(current_setting('test.matrix_policy')::jsonb||jsonb_build_object('currency',cur)),supported,'store policy currency '||cur);
 review:=jsonb_build_object('attributes','[{"slug":"description","definitionVersion":1,"value":"Synthetic","sourceIds":["f5240000-0000-4000-8000-000000000099"],"certainty":"observed"}]'::jsonb,
  'price',jsonb_build_object('currency',cur,'amount','123.45','rationale','Synthetic test','sourceIds','["f5240000-0000-4000-8000-000000000099"]'::jsonb),'questions','[]'::jsonb);
 return next is(komisio_private.valid_reception_review(review),supported,'review price currency '||cur);
 receipt:=jsonb_build_object('externalId',gen_random_uuid(),'occurredAt',now(),'currency',cur,'amountOre',12345,'blockedReason',null,'lines',
  jsonb_build_array(jsonb_build_object('lineNo',1,'reference',null,'labelConflict',false,'description','Synthetic','priceOre',12345,'productUuid',gen_random_uuid(),'variantUuid',gen_random_uuid())));
 return next is(komisio_private.valid_zettle_purchase(receipt),supported,'sale validator currency '||cur);
 return next is(komisio_private.valid_zettle_purchase(receipt||jsonb_build_object('refundOf',gen_random_uuid(),'amountOre',-12345,'blockedReason','refund')),supported,'refund validator currency '||cur);
 for constraint_row in select conname,pg_get_expr(conbin,conrelid) expression from pg_constraint
  where conrelid in ('public.sales'::regclass,'public.payouts'::regclass,'public.purchase_receipts'::regclass)
  and conname in ('sales_currency_check','payouts_currency_check','purchase_receipts_currency_check') loop
  execute 'select ('||constraint_row.expression||') from (select $1::text as currency) candidate' into accepted using cur;
  return next is(accepted,supported,constraint_row.conname||' accepts exactly supported currencies: '||cur);
 end loop;
end $$;
select is((select count(*) from pg_constraint where conrelid in ('public.sales'::regclass,'public.payouts'::regclass,'public.purchase_receipts'::regclass)
 and conname in ('sales_currency_check','payouts_currency_check','purchase_receipts_currency_check')),3::bigint,'all three currency constraints exist');
select result from matrix_currencies cross join lateral pg_temp.validator_parity(currency,true) as checks(result);
select * from pg_temp.validator_parity('JPY',false);
select * from finish();
rollback;
