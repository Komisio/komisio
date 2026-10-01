begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000441','vx-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000442','vx-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000441","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Spiris voucher test','spiris-voucher-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@vx.test','')::text,true);
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
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%SPIRIS_NOT_CONNECTED%','a send needs a connection');
-- A company kept in another currency than the store cannot receive the store's vouchers.
select store_spiris_connection(current_setting('test.tenant')::uuid,'5561234567','Komisio Test','556123-4567','EUR',current_setting('test.cipher')::jsonb,'ea:api',now()+interval '1 hour');
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%SPIRIS_CURRENCY_MISMATCH%','the company currency must match the store currency');
select disconnect_spiris(current_setting('test.tenant')::uuid);
select store_spiris_connection(current_setting('test.tenant')::uuid,'5561234567','Komisio Test','556123-4567','SEK',current_setting('test.cipher')::jsonb,'ea:api',now()+interval '1 hour');
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid())$$,'%EXPORT_NOT_FOUND%','the export must exist in the tenant');
-- Begin: pending row bound to the connected company, carrying the recorded lines.
select set_config('test.s1',gen_random_uuid()::text,true);
select set_config('test.b',begin_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,current_setting('test.export')::uuid)::text,true);
select is(current_setting('test.b')::jsonb->>'status','pending','send opened');
select is((current_setting('test.b')::jsonb->>'dispatchAllowed')::boolean,true,'the opener may dispatch');
select is(current_setting('test.b')::jsonb->>'companyKey','5561234567','bound to the connected company');
select is(jsonb_array_length(current_setting('test.b')::jsonb->'lines'),3,'recorded lines carried');
select is(current_setting('test.b')::jsonb->>'closeDate','2026-09-10','close date carried');
select set_config('test.r',begin_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,current_setting('test.export')::uuid)::text,true);
select is(current_setting('test.r')::jsonb->>'status','pending','replay by id returns the same row');
select is((current_setting('test.r')::jsonb->>'dispatchAllowed')::boolean,false,'a replay may not dispatch again');
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%SPIRIS_SEND_IN_PROGRESS%','a second send while pending is refused');
-- Complete as a preflight failure, then a new send may start; complete that one as sent.
select throws_like($$select complete_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'sent','','','','')$$,'%INVALID_INPUT%','sent needs a voucher number');
select is(complete_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'failed','','','SPIRIS_PREFLIGHT_FAILED','')->>'status','failed','closed as failed before POST');
select is(complete_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'failed','','','SPIRIS_PREFLIGHT_FAILED','')->>'status','failed','same outcome again is a no-op');
select throws_like($$select complete_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'sent','id','A7','','')$$,'%SEND_NOT_PENDING%','a closed send cannot change outcome');
select set_config('test.s2',gen_random_uuid()::text,true);
select is(begin_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,current_setting('test.export')::uuid)->>'status','pending','a new send after a preflight failure');
select set_config('test.c',complete_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,'sent','3fa85f64-5717-4562-b3fc-2c963f66afa6','A42','','')::text,true);
select is(current_setting('test.c')::jsonb->>'voucherNumber','A42','voucher number recorded');
select is(current_setting('test.c')::jsonb->>'voucherId','3fa85f64-5717-4562-b3fc-2c963f66afa6','voucher id recorded');
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%SPIRIS_ALREADY_SENT%','a sent export is never sent again');
select is((select count(*) from spiris_voucher_sends where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'two send rows, the failed one kept');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='spiris.voucher_sent'),1::bigint,'sent recorded as an access event');
-- An uncertain outcome holds a second export until the owner confirms the voucher.
select set_config('test.draft2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft2')::uuid,0,'Synthetic coat','Coats','Good');
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'inspection_draft',current_setting('test.draft2')::uuid,1,30000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-2','2026-09-11T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',30000)));
select set_config('test.close2',gen_random_uuid()::text,true);
select generate_day_close(current_setting('test.tenant')::uuid,current_setting('test.close2')::uuid,'2026-09-11');
select set_config('test.export2',export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close2')::uuid)::text,true);
select set_config('test.s3',gen_random_uuid()::text,true);
select begin_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,current_setting('test.export2')::uuid);
select complete_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'failed','','','SPIRIS_OUTCOME_UNKNOWN','');
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export2')::uuid)$$,'%SPIRIS_OUTCOME_UNKNOWN%','an uncertain outcome holds the export');
select throws_like($$select reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'confirmed_sent','','A43','')$$,'%INVALID_INPUT%','confirmation needs evidence');
select throws_like($$select reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'confirmed_absent','','A43','Looked')$$,'%INVALID_INPUT%','absence cannot be confirmed');
select set_config('test.rc',reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'confirmed_sent','','A43','Compared date and lines in Spiris')::text,true);
select is(current_setting('test.rc')::jsonb->>'status','sent','the owner confirmed the voucher');
select is(current_setting('test.rc')::jsonb->>'voucherNumber','A43','confirmed number recorded');
select is(reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'confirmed_sent','','A43','Compared date and lines in Spiris')->>'status','sent','the same confirmation replays');
select throws_like($$select reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'confirmed_sent','','A44','Other')$$,'%REQUEST_CONFLICT%','a different confirmation is refused');
select throws_like($$select reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,'confirmed_sent','','A42','Looked')$$,'%SEND_NOT_PENDING%','a sent row is not reconciled again');
select throws_like($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export2')::uuid)$$,'%SPIRIS_ALREADY_SENT%','the confirmed export is never sent again');
-- Staff can read but not send or confirm; direct changes are refused.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000442','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000442","role":"authenticated"}';
select is((select count(*) from spiris_voucher_sends where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'staff see the send log');
select throws_ok($$select begin_spiris_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'42501',null,'staff cannot send');
select throws_ok($$select reconcile_spiris_send(current_setting('test.tenant')::uuid,current_setting('test.s3')::uuid,'confirmed_sent','','A43','x')$$,'42501',null,'staff cannot confirm');
select throws_ok($$delete from spiris_voucher_sends$$,'42501',null,'no direct delete for members');
reset role;
select throws_ok($$update spiris_voucher_sends set status='failed',completed_at=now() where status='sent'$$,'55000',null,'a sent row is immutable even for the owner role');
select throws_ok($$delete from spiris_voucher_sends$$,'55000',null,'no delete even for the owner role');
select * from finish();
rollback;
