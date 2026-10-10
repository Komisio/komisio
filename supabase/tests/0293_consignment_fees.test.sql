begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000002931','fee-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000002932','fee-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002931","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Fee test','fee-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Fee seller','fee-seller@example.test','')::text,true);
select set_config('test.policy',gen_random_uuid()::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.policy')::uuid,null,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"consignmentPeriod":{"months":3,"collectionDays":2,"monthlyFee":{"amountOre":10000,"vatBasis":"inclusive","vatRatePercent":25,"collection":"balance"}},"markdownSteps":[],"endOfPeriodAction":"return"}');
select set_config('test.bag',receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'First')::text,true);
select set_config('test.period',(select id::text from seller_consignment_periods where seller_id=current_setting('test.seller')::uuid),true);
select set_config('test.fee',(select id::text from consignment_fees where period_id=current_setting('test.period')::uuid),true);
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,-10000::bigint,'first full fee may create a negative seller balance');
select is((select vat_ore from consignment_fees where id=current_setting('test.fee')::uuid),2000::numeric,'inclusive VAT is frozen separately');
select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Second');
select is((select count(*) from consignment_fees where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'two handovers in one seller month have one fee');
select is((select count(*) from seller_consignment_periods),1::bigint,'period belongs to seller across handovers');
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Fee coat','Coats','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,50000);
reset role;
select komisio_private.accrue_consignment_fees(current_setting('test.period')::uuid,now()+interval '2 months 1 hour','f0000000-0000-4000-8000-000000002931');
select is((select count(*) from consignment_fees where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'active item renews second and third full months');
select komisio_private.accrue_consignment_fees(current_setting('test.period')::uuid,now()+interval '4 months','f0000000-0000-4000-8000-000000002931');
select is((select count(*) from consignment_fees where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'end equal to boundary does not renew; collection days are not billed');
select komisio_private.accrue_consignment_fees(current_setting('test.period')::uuid,now()+interval '4 months','f0000000-0000-4000-8000-000000002931');
select is((select count(*) from consignment_fees where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'repeated scheduling never charges twice');
select throws_like($$update consignment_fees set gross_ore=1$$,'%IMMUTABLE_CONSIGNMENT_PERIOD%','fees are immutable');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002931","role":"authenticated"}';
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,-30000::bigint,'renewals debit the same ledger');
select set_config('test.correction',gen_random_uuid()::text,true);
select reverse_consignment_fee(current_setting('test.tenant')::uuid,current_setting('test.correction')::uuid,current_setting('test.fee')::uuid,'Mistaken receipt');
select reverse_consignment_fee(current_setting('test.tenant')::uuid,current_setting('test.correction')::uuid,current_setting('test.fee')::uuid,'Mistaken receipt');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,-20000::bigint,'correction is a single opposite ledger row');
select set_config('test.close',generate_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),(now() at time zone 'Europe/Stockholm')::date)::text,true);
select is((select per_mode->'consignment_fee'->>'grossOre' from day_closes where id=current_setting('test.close')::uuid),'30000','day close freezes gross balance deductions');
select is((select per_mode->'consignment_fee_reversal'->>'grossOre' from day_closes where id=current_setting('test.close')::uuid),'10000','fee correction is separately exportable');
select is((preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)->>'balanced')::boolean,false,'unmapped fees cannot be silently exported');
select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{
 "mode:consignment_fee:grossOre":{"account":"2890","side":"debit"},
 "mode:consignment_fee:netOre":{"account":"3041","side":"credit"},
 "mode:consignment_fee:vatOre":{"account":"2611","side":"credit"},
 "mode:consignment_fee_reversal:grossOre":{"account":"2890","side":"credit"},
 "mode:consignment_fee_reversal:netOre":{"account":"3041","side":"debit"},
 "mode:consignment_fee_reversal:vatOre":{"account":"2611","side":"debit"}}');
select is((preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)->>'balanced')::boolean,true,'explicit fee accounts create a balanced voucher');
select throws_like($$select request_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,10000)$$,'%PAYOUT_EXCEEDS_BALANCE%','debt cannot be paid out');
select throws_like($$select reverse_consignment_fee(current_setting('test.tenant')::uuid,current_setting('test.correction')::uuid,current_setting('test.fee')::uuid,'Different reason')$$,'%REQUEST_CONFLICT%','changed correction replay rejected');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"consignmentPeriod":{"months":3,"collectionDays":2,"monthlyFee":{"amountOre":10000,"vatBasis":"exclusive","vatRatePercent":25,"collection":"separate"}}}');
select set_config('test.seller2',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Separate seller','separate@example.test','')::text,true);
select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller2')::uuid,'Separate fee');
select set_config('test.fee2',(select id::text from consignment_fees where seller_id=current_setting('test.seller2')::uuid),true);
select is((select gross_ore from consignment_fees where id=current_setting('test.fee2')::uuid),12500::numeric,'exclusive VAT increases the payable total');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller2')::uuid)->>'availableOre')::bigint,0::bigint,'separate collection never debits seller balance');
select set_config('test.payment',gen_random_uuid()::text,true);
select record_consignment_fee_payment(current_setting('test.tenant')::uuid,current_setting('test.payment')::uuid,current_setting('test.fee2')::uuid,'POS receipt 123');
select record_consignment_fee_payment(current_setting('test.tenant')::uuid,current_setting('test.payment')::uuid,current_setting('test.fee2')::uuid,'POS receipt 123');
select is((select count(*) from consignment_fee_events where fee_id=current_setting('test.fee2')::uuid and kind='paid'),1::bigint,'external payment reference is recorded exactly once');
select throws_like($$select record_consignment_fee_payment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.fee2')::uuid,'POS receipt 124')$$,'%FEE_DECIDED%','cannot pay an already paid fee');
select throws_ok($$insert into consignment_fee_events(id,tenant_id,fee_id,kind,reference,actor) values(gen_random_uuid(),current_setting('test.tenant')::uuid,current_setting('test.fee2')::uuid,'paid','direct',auth.uid())$$,'42501',null,'direct payment writes denied');
select is((seller_consignment_fees(current_setting('test.tenant')::uuid,current_setting('test.seller2')::uuid)->'rows'->0->>'status'),'paid','fee history reflects external payment');
select is((select per_mode->'consignment_fee'->>'grossOre' from day_closes where id=generate_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),(now() at time zone 'Europe/Stockholm')::date)),'30000','external payment is not booked a second time');
select throws_like($$select reverse_consignment_fee(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.fee2')::uuid,'No refund evidence')$$,'%FEE_DECIDED%','paid external fee cannot be silently refunded');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"consignmentPeriod":{"months":3,"collectionDays":2,"monthlyFee":{"amountOre":1,"vatBasis":"inclusive","vatRatePercent":100,"collection":"separate"}}}');
select set_config('test.tiny',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Rounding seller','rounding@example.test','')::text,true);
select lives_ok($$select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.tiny')::uuid,'Rounding receipt')$$,'small inclusive fee permits a rounded zero net amount');
select is((select net_ore from consignment_fees where seller_id=current_setting('test.tiny')::uuid),0::numeric,'VAT rounds to ore in SQL');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002932','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002932","role":"authenticated"}';
select throws_ok($$select reverse_consignment_fee(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.fee')::uuid,'Staff cannot reverse')$$,'42501',null,'staff cannot correct financial fees');
reset role;
delete from tenant_members where tenant_id=current_setting('test.tenant')::uuid and user_id='f0000000-0000-4000-8000-000000002932';
insert into auth.users(id,email,email_confirmed_at) values('f0000000-0000-4000-8000-000000002933','fee-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002933","role":"authenticated"}';
select is((my_consignment_fees(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'total')::integer,3,'seller can read own fees');
select ok(not (my_consignment_fees(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->'rows'->0 ? 'recorded_by'),'seller fee history strips internal actor');
select throws_ok($$select my_consignment_fees(current_setting('test.tenant')::uuid,current_setting('test.seller2')::uuid)$$,'42501',null,'seller cannot read another account');
reset role;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000002931','Fee test','totp','verified','synthetic',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002931","role":"authenticated","aal":"aal1"}';
select throws_ok($$select accrue_seller_consignment_fees(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'fee catchup requires MFA');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002932","role":"authenticated"}';
select is((select count(*) from consignment_fees where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'fees isolated by tenant');
select throws_ok($$select seller_consignment_fees(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'fee RPC cannot cross tenant boundary');
reset role;
select ok((select bool_and(id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$') from consignment_fees where tenant_id=current_setting('test.tenant')::uuid),'deterministic fee IDs satisfy UUID client contracts');
select komisio_private.enable_billing('f0000000-0000-4000-8000-000000002931');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002931","role":"authenticated","aal":"aal2"}';
select close_store(current_setting('test.tenant')::uuid,'Synthetic store closure');
select throws_like($$select record_consignment_fee_payment(current_setting('test.tenant')::uuid,gen_random_uuid(),(select id from consignment_fees where seller_id=current_setting('test.tiny')::uuid),'Closed store receipt')$$,'%PLAN_READ_ONLY%','closed stores cannot record new fee payments');
select * from finish();
rollback;
