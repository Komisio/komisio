begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic frozen daily amounts exercise the same projection used by both providers.
create function pg_temp.payout_close(amount bigint) returns public.day_closes
language sql as $$
 select jsonb_populate_record(null::public.day_closes,jsonb_build_object(
  'gross_ore',0,'refunds_ore',0,'commission_ore',0,'commission_vat_ore',0,
  'seller_credit_ore',0,'credit_reversed_ore',0,'payouts_paid_ore',amount,'per_mode','{}'::jsonb))
$$;
select set_config('test.pair','{"payoutsPaidOre":{"account":"1930","side":"credit"},"payoutsPaidCounterpartOre":{"account":"2890","side":"debit"}}',true);
select set_config('test.economic_pair','{"payoutsPaidOre":{"account":"10000","side":"credit","vatCode":"Z0"},"payoutsPaidCounterpartOre":{"account":"20000","side":"debit","vatCode":"Z0"}}',true);

select ok(komisio_private.valid_accounting_map(current_setting('test.pair')::jsonb),'shared map accepts explicit payout counterpart');
select ok(komisio_private.valid_economic_map(current_setting('test.economic_pair')::jsonb),'economic map accepts explicit payout counterpart');
select set_config('test.voucher',komisio_private.voucher_for(pg_temp.payout_close(12345),current_setting('test.pair')::jsonb)::text,true);
select is(jsonb_array_length(current_setting('test.voucher')::jsonb->'lines'),2,'payout-only day has both postings');
select is(current_setting('test.voucher')::jsonb->>'debitOre','12345','counterpart is the exact paid amount');
select is(current_setting('test.voucher')::jsonb->>'creditOre','12345','payment is the exact paid amount');
select is(current_setting('test.voucher')::jsonb->>'balanced','true','payout-only voucher balances');
select is(jsonb_array_length(komisio_private.voucher_for(pg_temp.payout_close(0),current_setting('test.pair')::jsonb)->'lines'),0,'zero paid payouts produce no postings');
select is(komisio_private.voucher_for(pg_temp.payout_close(12345),'{}')->>'balanced','false','paid payout cannot be silently omitted');
select ok((komisio_private.voucher_for(pg_temp.payout_close(12345),'{}')->'unmapped') ? 'payoutsPaidCounterpartOre','missing counterpart is identified');
select is(komisio_private.voucher_for(pg_temp.payout_close(12345),current_setting('test.pair')::jsonb-'payoutsPaidCounterpartOre')->>'balanced','false','legacy single-sided payout map needs review');
select ok(not komisio_private.valid_accounting_map(jsonb_set(current_setting('test.pair')::jsonb,'{payoutsPaidCounterpartOre,side}','"credit"')),'same-sided payout pair refused');
select ok(not komisio_private.valid_accounting_map(jsonb_set(current_setting('test.pair')::jsonb,'{payoutsPaidCounterpartOre,account}','"1930"')),'same-account payout pair refused');

select set_config('test.voucher',komisio_private.economic_voucher_for(pg_temp.payout_close(12345),current_setting('test.economic_pair')::jsonb)::text,true);
select is(jsonb_array_length(current_setting('test.voucher')::jsonb->'lines'),2,'economic gets both payout postings');
select is(current_setting('test.voucher')::jsonb->>'balanced','true','economic payout-only voucher balances');
select is(current_setting('test.voucher')::jsonb->>'debitOre','12345','economic counterpart preserves ore');
select is(current_setting('test.voucher')::jsonb->>'creditOre','12345','economic payment preserves ore');
select is(komisio_private.economic_voucher_for(pg_temp.payout_close(12345),current_setting('test.economic_pair')::jsonb-'payoutsPaidCounterpartOre')->>'balanced','false','economic legacy payout mapping remains blocked');
select ok(not komisio_private.valid_economic_map(jsonb_set(current_setting('test.economic_pair')::jsonb,'{payoutsPaidCounterpartOre}','{"excludeReason":"Posted externally"}')),'economic cannot exclude only one payout leg');
select ok(komisio_private.valid_economic_map('{"payoutsPaidOre":{"excludeReason":"Posted externally"},"payoutsPaidCounterpartOre":{"excludeReason":"Posted externally"}}'),'economic can explicitly exclude both payout legs');
select is(jsonb_array_length(komisio_private.economic_voucher_for(pg_temp.payout_close(12345),'{"payoutsPaidOre":{"excludeReason":"Posted externally"},"payoutsPaidCounterpartOre":{"excludeReason":"Posted externally"}}')->'lines'),0,'explicit external posting excludes the complete pair');

-- A balanced sales subset must not hide an unconfigured paid payout.
select set_config('test.mixed',jsonb_build_object('grossOre',jsonb_build_object('account','1930','side','debit'),
 'commissionOre',jsonb_build_object('account','3010','side','credit'))::text,true);
select is(komisio_private.voucher_for(jsonb_populate_record(pg_temp.payout_close(12345),
 '{"gross_ore":20000,"commission_ore":20000}'),current_setting('test.mixed')::jsonb)->>'balanced','false','balanced sale cannot hide an omitted payout');
select is(komisio_private.voucher_for(jsonb_populate_record(pg_temp.payout_close(12345),
 '{"gross_ore":20000,"commission_ore":20000}'),current_setting('test.mixed')::jsonb||current_setting('test.pair')::jsonb)->>'debitOre','32345','mixed day includes sale and paid payout');
select is(komisio_private.voucher_for(jsonb_populate_record(pg_temp.payout_close(0),
 '{"gross_ore":20000,"commission_ore":20000}'),current_setting('test.mixed')::jsonb)->>'balanced','true','day without paid payouts keeps existing sale behavior');
select ok(not has_function_privilege('authenticated','komisio_private.payout_mapping_complete(jsonb,boolean)','execute'),'private mapping helper not exposed');

-- Public engine paths retain tenant scope, frozen exports and incremental
-- e-conomic targets. The inserted closes are synthetic immutable fixtures.
insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000005611','payout-accounting@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005611","role":"authenticated"}';
select set_config('test.tenant',create_tenant_with_locale('Payout accounting','payout-accounting',gen_random_uuid(),'dk')::text,true);
select set_config('test.map',publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.pair')::jsonb)::text,true);
select store_economic_connection(current_setting('test.tenant')::uuid,123456,'Synthetic','','DKK','{"iv":"a","tag":"b","data":"c"}');
select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,123456,1,current_setting('test.economic_pair')::jsonb);
reset role;
insert into day_closes(id,tenant_id,close_date,version,payouts_paid_ore,generated_by,payout_sources)
 select ('f0000000-0000-4000-8000-00000000561'||n)::uuid,current_setting('test.tenant')::uuid,'2026-10-20',n,n*12345,'f0000000-0000-4000-8000-000000005611',
 (select jsonb_agg(jsonb_build_object('payoutId',('f0000000-0000-4000-8000-00000000562'||k)::uuid,'sellerId','f0000000-0000-4000-8000-000000005630','amountOre',12345,'reference','BANK-'||k,'paidAt','2026-10-20T12:00:00Z') order by k) from generate_series(1,n) k) from generate_series(2,3) n;
set local role authenticated;
select set_config('test.shared_export',export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005612')::text,true);
select is((select jsonb_array_length(voucher) from accounting_exports where id=current_setting('test.shared_export')::uuid),2,'shared export freezes both payout postings');
select is(export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005612')::text,current_setting('test.shared_export'),'repeated export of the same close returns the frozen export');
select throws_ok($$select preview_voucher(gen_random_uuid(),'f0000000-0000-4000-8000-000000005612')$$,'42501',null,'payout preview cannot cross tenants');
select set_config('test.economic_export',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005612')::text,true);
select set_config('test.send',gen_random_uuid()::text,true);
select begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,current_setting('test.economic_export')::uuid);
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005613')->>'blockedReason','ECONOMIC_DAY_UNRESOLVED','pending payout voucher blocks a later version');
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,'sent',42,'','',null);
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005613')->>'debitOre','12345','later paid payout exports only its additional debit');
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005613')->>'creditOre','12345','later paid payout exports only its additional credit');
select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.map')::uuid,jsonb_set(current_setting('test.pair')::jsonb,'{payoutsPaidCounterpartOre,account}','"2899"'));
select is((select l->>'account' from accounting_exports e,jsonb_array_elements(e.voucher) l where e.id=current_setting('test.shared_export')::uuid and l->>'key'='payoutsPaidCounterpartOre'),'2890','publishing another map preserves the frozen counterpart');

reset role;
insert into day_closes(id,tenant_id,close_date,version,payouts_paid_ore,generated_by)
 values('f0000000-0000-4000-8000-000000005619',current_setting('test.tenant')::uuid,'2026-10-19',1,12345,'f0000000-0000-4000-8000-000000005611');
set local role authenticated;
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005619')->>'blockedReason','ACCOUNTING_PAYOUT_HISTORY_REVIEW','economic refuses paid legacy closes without frozen sources');
reset role;
insert into economic_exports(id,tenant_id,day_close_id,map_id,agreement_number,journal_number,voucher,excluded,debit_ore,credit_ore,created_by)
 select gen_random_uuid(),tenant_id,'f0000000-0000-4000-8000-000000005619',map_id,agreement_number,journal_number,voucher,excluded,debit_ore,credit_ore,created_by from economic_exports where id=current_setting('test.economic_export')::uuid;
insert into day_closes(id,tenant_id,close_date,version,payouts_paid_ore,generated_by,payout_sources)
 select 'f0000000-0000-4000-8000-000000005618',tenant_id,'2026-10-19',2,payouts_paid_ore,generated_by,payout_sources from day_closes where id='f0000000-0000-4000-8000-000000005612';
set local role authenticated;
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005618')->>'blockedReason','ACCOUNTING_PAYOUT_HISTORY_REVIEW','regenerated economic evidence cannot silently re-export legacy payments');

select * from finish();
rollback;
