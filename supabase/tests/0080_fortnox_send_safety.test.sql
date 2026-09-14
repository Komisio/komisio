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

select set_config('test.send',gen_random_uuid()::text,true);
select is((begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,current_setting('test.export')::uuid)->>'dispatchAllowed')::boolean,true,'only fresh begin grants HTTP dispatch');
select is((begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,current_setting('test.export')::uuid)->>'dispatchAllowed')::boolean,false,'pending replay never grants a second POST');
reset role;
alter table fortnox_voucher_sends disable trigger fortnox_voucher_sends_guard;
update fortnox_voucher_sends set created_at=now()-interval '1 day' where id=current_setting('test.send')::uuid;
alter table fortnox_voucher_sends enable trigger fortnox_voucher_sends_guard;
set local role authenticated;
select throws_like($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%FORTNOX_SEND_IN_PROGRESS%','age cannot prove a voucher was not created');
select complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,'failed','',null,null,'FORTNOX_OUTCOME_UNKNOWN','');
select throws_like($$select begin_fortnox_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%FORTNOX_OUTCOME_UNKNOWN%','unknown external outcome holds the export');
select is((select count(*) from fortnox_voucher_sends where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'no replacement send created');
select * from finish();
rollback;

