begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000131','sale-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000132','sale-reader@example.test',now()),
 ('f0000000-0000-4000-8000-000000000134','sale-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000131","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Sale notes test','sale-payments-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@sales.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
-- Consignment item from the bag path, store item from a purchase.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'reception_review',current_setting('test.draft')::uuid,1,25000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea market',15000,'Receipt 7',true)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000);
create temp view lines as select jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',25000),jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',25000)) as l;
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin"}');
create function pg_temp.payment_sale(method text, ext text, item uuid) returns uuid language sql as $$
 select record_sale(current_setting('test.tenant')::uuid,md5(ext)::uuid,'manual',ext,'2026-10-20T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',item,'priceOre',25000)),jsonb_build_object('paymentMethod',method))
$$;
select throws_like($$select pg_temp.payment_sale('invented','PAY-1',current_setting('test.item1')::uuid)$$,'%INVALID_INPUT%','unknown payment method rejected');
select lives_ok($$select pg_temp.payment_sale('mobilepay','PAY-1',current_setting('test.item1')::uuid)$$,'MobilePay sale accepted');
select lives_ok($$select pg_temp.payment_sale('mobilepay','PAY-1',current_setting('test.item1')::uuid)$$,'exact payment replay accepted');
select throws_like($$select pg_temp.payment_sale('cash','PAY-1',current_setting('test.item1')::uuid)$$,'%SALE_CONFLICT%','payment cannot change on replay');
select lives_ok($$select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','LEGACY','2026-10-20T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',25000)))$$,'legacy command preserved');
select is((select payment_method from sales where external_id='LEGACY'),'unspecified','legacy method not invented');
select is(sale_detail(current_setting('test.tenant')::uuid,md5('PAY-1')::uuid)->'sale'->>'payment_method','mobilepay','receipt exposes method');
select set_config('test.close',generate_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-10-20')::text,true);
select is((select payment_totals->'mobilepay'->>'grossOre' from day_closes where id=current_setting('test.close')::uuid),'25000','payment bucket frozen');
select is(generate_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-10-20'),current_setting('test.close')::uuid,'unchanged close reused');
select is((select sum(amount_ore) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid and kind='credit_sale'),10000::numeric,'seller credit unaffected');
reset role;
select throws_like($$update sales set payment_method='cash' where external_id='PAY-1'$$,'%IMMUTABLE_SALE%','method immutable');
-- Projection is tested for both targets with explicit maps, not inferred accounts.
create temp view payment_close as select d as row_value from day_closes d where id=current_setting('test.close')::uuid;
create temp view payment_map as select '{"grossOre":{"account":"1000","side":"debit"},"payment:mobilepay:grossOre":{"account":"1100","side":"debit"},"sellerCreditOre":{"account":"2000","side":"credit"},"mode:consignment_margin:netOre":{"account":"3000","side":"credit"},"mode:consignment_margin:vatOre":{"account":"4000","side":"credit"},"mode:store_margin:netOre":{"account":"3000","side":"credit"},"mode:store_margin:vatOre":{"account":"4000","side":"credit"}}'::jsonb m;
-- Existing map convention counts commission on the debit side alongside seller liability.
-- Use the same projection values as current exports and assert exact separation.
select is((komisio_private.voucher_for((select row_value from payment_close),(select m from payment_map))->'lines'->0) is not null,true,'voucher projects lines');
select is((select (l->>'amountOre')::bigint from jsonb_array_elements(komisio_private.voucher_for((select row_value from payment_close),(select m from payment_map))->'lines') l where l->>'key'='grossOre'),25000::bigint,'legacy receipt contains unspecified sales only');
select is((select (l->>'amountOre')::bigint from jsonb_array_elements(komisio_private.voucher_for((select row_value from payment_close),(select m from payment_map))->'lines') l where l->>'key'='payment:mobilepay:grossOre'),25000::bigint,'MobilePay receipt has separate mapping');
select is((komisio_private.voucher_for((select row_value from payment_close),(select m-'payment:mobilepay:grossOre' from payment_map))->>'balanced')::boolean,false,'missing payment mapping blocks export');
create temp view excluded_map as select (m-'payment:mobilepay:grossOre')||'{"payment:mobilepay:grossOre":{"excludeReason":"Store books entire MobilePay sale"},"payment:mobilepay:refundsOre":{"excludeReason":"Store books entire MobilePay sale"}}'::jsonb m from payment_map;
select is(komisio_private.valid_accounting_map((select m from excluded_map)),true,'Fortnox accepts paired explicit method exclusion');
select is(komisio_private.valid_accounting_map((select m-'payment:mobilepay:refundsOre' from excluded_map)),false,'partial exclusion rejected');
select is((select count(*) from jsonb_array_elements(komisio_private.voucher_for((select row_value from payment_close),(select m from excluded_map))->'lines') l where l->>'key' in ('sellerCreditOre','mode:consignment_margin:netOre','mode:consignment_margin:vatOre')),0::bigint,'whole excluded sale removes liability and VAT contributions');
select is(komisio_private.voucher_for((select row_value from payment_close),(select m from excluded_map))->'excluded'->'payment:mobilepay:grossOre'->>'amountOre','25000','exclusion visible with frozen amount');
-- Balanced projection follows the store's existing chosen amount-key scheme.
create temp view balanced_map as select m-'sellerCreditOre' as m from payment_map;
select is((komisio_private.voucher_for((select row_value from payment_close),(select m from balanced_map))->>'balanced')::boolean,true,'split receipts balance under existing amount scheme');
create temp view economic_payment_map as select
 (select jsonb_object_agg(k,case when b.m ? k then b.m->k||'{"vatCode":"UEUV"}'::jsonb else '{"excludeReason":"Synthetic map choice"}'::jsonb end)
  from jsonb_object_keys(komisio_private.payment_amounts((select row_value from payment_close),b.m)->'amounts') k) m from balanced_map b;
select is(komisio_private.valid_economic_map((select m from economic_payment_map)),true,'economic split map valid');
select is((komisio_private.economic_voucher_for((select row_value from payment_close),(select m from economic_payment_map))->>'balanced')::boolean,true,'economic split balances');
select is((select (l->>'amountOre')::bigint from jsonb_array_elements(komisio_private.economic_voucher_for((select row_value from payment_close),(select m from economic_payment_map))->'lines') l where l->>'key'='payment:mobilepay:grossOre'),25000::bigint,'economic MobilePay has exact split');
create temp view economic_excluded_map as select e.m||jsonb_build_object('payment:mobilepay:grossOre',x.m->'payment:mobilepay:grossOre','payment:mobilepay:refundsOre',x.m->'payment:mobilepay:refundsOre') m from economic_payment_map e,excluded_map x;
select is((komisio_private.economic_voucher_for((select row_value from payment_close),(select m from economic_excluded_map))->>'balanced')::boolean,true,'economic whole exclusion still balances');
select is((select count(*) from jsonb_array_elements(komisio_private.economic_voucher_for((select row_value from payment_close),(select m from economic_excluded_map))->'lines') l where l->>'key' like 'mode:consignment_margin:%'),0::bigint,'economic exclusion omits associated VAT and net');
select is(komisio_private.economic_voucher_for((select row_value from payment_close),(select m from economic_excluded_map))->'excluded'->'payment:mobilepay:grossOre'->>'amountOre','25000','economic exclusion evidence');
-- Independent fees and paid payouts are not owned by the excluded tender.
create temp view payment_close_with_fee as select jsonb_populate_record(row_value,
 jsonb_build_object('per_mode',(row_value).per_mode||'{"consignment_fee":{"lines":1,"grossOre":1250,"netOre":1000,"vatOre":250}}'::jsonb,'payouts_paid_ore',1000)) row_value from payment_close;
select is(komisio_private.payment_amounts((select row_value from payment_close_with_fee),(select m from excluded_map))->'amounts'->>'mode:consignment_fee:grossOre','1250','whole-method exclusion preserves independent fee');
select is(komisio_private.payment_amounts((select row_value from payment_close_with_fee),(select m from excluded_map))->'amounts'->>'payoutsPaidCounterpartOre','1000','whole-method exclusion preserves paid payout counterpart');
select is((komisio_private.voucher_for((select row_value from payment_close_with_fee),(select m from excluded_map))->'unmapped') ? 'mode:consignment_fee:vatOre',true,'unmapped independent fee is still reported');
select is((komisio_private.economic_voucher_for((select row_value from payment_close_with_fee),(select m from economic_excluded_map))->'unmapped') ? 'payoutsPaidCounterpartOre',true,'incomplete payout mapping still blocks economic delivery');

grant select on excluded_map to authenticated;
set local role authenticated;
select set_config('test.export_map',publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(select m-'sellerCreditOre' from excluded_map))::text,true);
select set_config('test.export',export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid)::text,true);
select is((select excluded->'payment:mobilepay:grossOre'->>'amountOre' from accounting_exports where id=current_setting('test.export')::uuid),'25000','Fortnox/SIE export freezes exclusion');
select record_return(current_setting('test.tenant')::uuid,gen_random_uuid(),(select id from sale_lines where sale_id=md5('PAY-1')::uuid),25000,'Synthetic return','2026-10-21T10:00:00Z');
select set_config('test.return_close',generate_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-10-21')::text,true);
select is((select payment_totals->'mobilepay'->>'refundsOre' from day_closes where id=current_setting('test.return_close')::uuid),'25000','return follows original payment method on return day');
select is((select payment_totals->'mobilepay'->>'creditReversedOre' from day_closes where id=current_setting('test.return_close')::uuid),'10000','return bucket contains actual seller reversal');
select is((select payment_totals->'mobilepay'->>'refundsOre' from day_closes where id=current_setting('test.close')::uuid),'0','original close frozen after return');
reset role;
select is(jsonb_array_length(komisio_private.economic_voucher_for((select c from day_closes c where c.id=current_setting('test.return_close')::uuid),(select m from economic_excluded_map))->'lines'),0,'excluded return emits no unmatched counterpart');
select is((select sum(amount_ore) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid),0::numeric,'actual return still reverses seller credit');
select * from finish();
rollback;
