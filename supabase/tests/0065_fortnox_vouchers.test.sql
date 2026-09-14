begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000411','fx-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000412','fx-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000411","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Fortnox voucher test','fortnox-voucher-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@fx.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,20000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',20000)));
select set_config('test.close',gen_random_uuid()::text,true);
select generate_day_close(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid,'2026-09-10');
select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,
 '{"grossOre":{"account":"1930","side":"debit"},"sellerCreditOre":{"account":"2890","side":"credit"},"commissionOre":{"account":"3010","side":"credit"},"commissionVatOre":{"account":"2610","side":"credit"}}');
select set_config('test.export',export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid)::text,true);
select set_config('test.cipher','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',true);
-- No connection: nothing to send with.
select throws_like($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%FORTNOX_NOT_CONNECTED%','a send needs a connection');
select store_fortnox_connection(current_setting('test.tenant')::uuid,'1751085','Komisio Test','5561234567',current_setting('test.cipher')::jsonb,'bookkeeping',now()+interval '1 hour');
select throws_like($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid())$$,'%EXPORT_NOT_FOUND%','the export must exist in the tenant');
-- Begin: pending row bound to the connected database, carrying the recorded lines.
select set_config('test.s1',gen_random_uuid()::text,true);
select set_config('test.b',begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,current_setting('test.export')::uuid)::text,true);
select is(current_setting('test.b')::jsonb->>'status','pending','send opened');
select is(current_setting('test.b')::jsonb->>'databaseNumber','1751085','bound to the connected company database');
select is(jsonb_array_length(current_setting('test.b')::jsonb->'lines'),3,'recorded lines carried');
select is(current_setting('test.b')::jsonb->>'closeDate','2026-09-10','close date carried');
select is(begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,current_setting('test.export')::uuid)->>'status','pending','replay by id returns the same row');
select throws_like($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%FORTNOX_SEND_IN_PROGRESS%','a second send while pending is refused');
-- Complete as failed, then a new send may start; complete that one as sent.
select throws_like($$select complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'sent','A',null,2026,'','')$$,'%INVALID_INPUT%','sent needs a voucher number');
select is(complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'failed','',null,null,'FORTNOX_CONNECTION_FAILED','timeout')->>'status','failed','closed as failed');
select is(complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'failed','',null,null,'FORTNOX_CONNECTION_FAILED','')->>'status','failed','same outcome again is a no-op');
select throws_like($$select complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'sent','A',7,2026,'','')$$,'%SEND_NOT_PENDING%','a closed send cannot change outcome');
select set_config('test.s2',gen_random_uuid()::text,true);
select is(begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,current_setting('test.export')::uuid)->>'status','pending','a new send after a failure');
select set_config('test.c',complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,'sent','A',42,2026,'','')::text,true);
select is(current_setting('test.c')::jsonb->>'voucherNumber','42','voucher number recorded');
select is(current_setting('test.c')::jsonb->>'voucherSeries','A','series recorded');
select throws_like($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%FORTNOX_ALREADY_SENT%','a sent export is never sent again');
select is((select count(*) from fortnox_voucher_sends where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'two send rows, the failed one kept');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='fortnox.voucher_sent'),1::bigint,'sent recorded as an access event');
-- Staff can read but not send; direct changes are refused.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000412','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000412","role":"authenticated"}';
select is((select count(*) from fortnox_voucher_sends where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'staff see the send log');
select throws_ok($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'42501',null,'staff cannot send');
select throws_ok($$delete from fortnox_voucher_sends$$,'42501',null,'no direct delete for members');
reset role;
select throws_ok($$update fortnox_voucher_sends set status='failed',completed_at=now() where status='sent'$$,'55000',null,'a sent row is immutable even for the owner role');
select throws_ok($$delete from fortnox_voucher_sends$$,'55000',null,'no delete even for the owner role');
-- A store in another currency cannot send: Fortnox vouchers are in the company currency.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000411","role":"authenticated"}';
select set_config('test.nok',create_tenant('Fortnox NOK test','fortnox-nok-test',gen_random_uuid())::text,true);
select publish_store_policy(current_setting('test.nok')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.nok')::uuid)->'policy') || '{"currency":"NOK"}');
select store_fortnox_connection(current_setting('test.nok')::uuid,'2','Komisio Test','',current_setting('test.cipher')::jsonb,'',now()+interval '1 hour');
select throws_like($$select begin_fortnox_send(current_setting('test.nok')::uuid,gen_random_uuid(),gen_random_uuid())$$,'%FORTNOX_CURRENCY_UNSUPPORTED%','a NOK store cannot send to Fortnox in version 1');
select * from finish();
rollback;
