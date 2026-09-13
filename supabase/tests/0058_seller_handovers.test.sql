begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- The seller signs in with the address the store registered; no membership.
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000361','handover-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000362','dropoff-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000000363','other-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000361","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Handover test','handover-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Dropoff Seller','dropoff-seller@example.test','')::text,true);
select set_config('test.other',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Other Seller','other-seller@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',true)::text,true);
-- Not enabled by the default policy.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000362","role":"authenticated"}';
select is((my_handovers(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'enabled')::boolean,false,'self drop-off is off by default');
select throws_like($$select create_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'bag',5,'')$$,'%HANDOVER_NOT_ENABLED%','announcing is refused while the policy lacks seller_dropoff');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000361","role":"authenticated"}';
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"custodySources":["staff_receipt","seller_dropoff"]}');
-- The seller announces a bag; replay, validation, identity boundary.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000362","role":"authenticated"}';
select set_config('test.h1',gen_random_uuid()::text,true);
select is(create_my_handover(current_setting('test.tenant')::uuid,current_setting('test.h1')::uuid,current_setting('test.seller')::uuid,'bag',5,'Winter coats'),current_setting('test.h1')::uuid,'handover announced');
select is(create_my_handover(current_setting('test.tenant')::uuid,current_setting('test.h1')::uuid,current_setting('test.seller')::uuid,'bag',5,'Winter coats'),current_setting('test.h1')::uuid,'replay returns the handover');
select throws_like($$select create_my_handover(current_setting('test.tenant')::uuid,current_setting('test.h1')::uuid,current_setting('test.seller')::uuid,'box',5,'Winter coats')$$,'%REQUEST_CONFLICT%','same id with another payload conflicts');
select throws_like($$select create_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'crate',5,'')$$,'%INVALID_INPUT%','kind is bag or box');
select throws_like($$select create_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'bag',501,'')$$,'%INVALID_INPUT%','at most 500 estimated items');
select throws_ok($$select create_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.other')::uuid,'bag',1,'')$$,'42501',null,'a seller cannot announce for another seller');
select matches((my_handovers(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->'handovers'->0->>'reference'),'^H-[0-9]+$','the seller sees the reference');
select is((my_handovers(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->'handovers'->0->>'status'),'open','open until the store receives it');
select throws_ok($$select my_handovers(current_setting('test.tenant')::uuid,current_setting('test.other')::uuid)$$,'42501',null,'a seller cannot list another seller''s handovers');
select throws_ok($$select handover_queue(current_setting('test.tenant')::uuid)$$,'42501',null,'the seller is not a member and cannot see the staff queue');
select throws_ok($$select receive_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h1')::uuid,'staff_receipt','')$$,'42501',null,'the seller cannot receive');
-- A second handover the seller cancels.
select set_config('test.h2',gen_random_uuid()::text,true);
select create_my_handover(current_setting('test.tenant')::uuid,current_setting('test.h2')::uuid,current_setting('test.seller')::uuid,'box',12,'');
select set_config('test.c2',gen_random_uuid()::text,true);
select is(cancel_my_handover(current_setting('test.tenant')::uuid,current_setting('test.c2')::uuid,current_setting('test.h2')::uuid),current_setting('test.c2')::uuid,'cancelled by the seller');
select is(cancel_my_handover(current_setting('test.tenant')::uuid,current_setting('test.c2')::uuid,current_setting('test.h2')::uuid),current_setting('test.c2')::uuid,'cancel replays');
select throws_like($$select cancel_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h2')::uuid)$$,'%HANDOVER_DECIDED%','a cancelled handover cannot be cancelled again');
-- Staff receives the first one: the agreement is required before receipt, so evidence first.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000361","role":"authenticated"}';
select is(jsonb_array_length(handover_queue(current_setting('test.tenant')::uuid)),2,'staff queue lists both');
select is(handover_queue(current_setting('test.tenant')::uuid)->0->>'sellerName','Dropoff Seller','open one first with the seller name');
select throws_like($$select receive_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h1')::uuid,'staff_receipt','')$$,'%AGREEMENT_REQUIRED%','receiving follows the bag receipt rules: evidence required');
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed at the counter');
select throws_like($$select receive_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h1')::uuid,'locker','')$$,'%CUSTODY_SOURCE_NOT_ALLOWED%','locker custody needs the policy');
select throws_like($$select receive_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h2')::uuid,'staff_receipt','')$$,'%HANDOVER_DECIDED%','a cancelled handover cannot be received');
select throws_like($$select receive_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid(),'staff_receipt','')$$,'%HANDOVER_NOT_FOUND%','unknown handover');
select set_config('test.r1',gen_random_uuid()::text,true);
select is(receive_handover(current_setting('test.tenant')::uuid,current_setting('test.r1')::uuid,current_setting('test.h1')::uuid,'staff_receipt','Scanned at the counter'),current_setting('test.r1')::uuid,'received by staff');
select is((select status||'|'||custody_source from seller_handovers where id=current_setting('test.h1')::uuid),'received|staff_receipt','status and custody source recorded');
select is((select seller_id from bag_receipts where id=md5(current_setting('test.h1')||':received')::uuid),current_setting('test.seller')::uuid,'a bag receipt for the seller exists with the derived id');
select is((select agreement_evidence_id is not null from bag_receipts where id=md5(current_setting('test.h1')||':received')::uuid),true,'the bag receipt carries the agreement evidence');
select is((select note from bag_receipts where id=md5(current_setting('test.h1')||':received')::uuid),'Scanned at the counter','the note is the bag note');
select is(receive_handover(current_setting('test.tenant')::uuid,current_setting('test.r1')::uuid,current_setting('test.h1')::uuid,'staff_receipt','Scanned at the counter'),current_setting('test.r1')::uuid,'receive replays');
select throws_like($$select receive_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h1')::uuid,'staff_receipt','')$$,'%HANDOVER_DECIDED%','cannot receive twice');
select is((select count(*) from bag_receipts where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'exactly one bag receipt');
select is((select count(*) from handover_events where handover_id=current_setting('test.h1')::uuid),2::bigint,'created and received events');
-- The seller sees the result; the cancelled one stays visible.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000362","role":"authenticated"}';
select matches((select h->>'bagReference' from jsonb_array_elements(my_handovers(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->'handovers') h where h->>'id'=current_setting('test.h1')),'^K-[0-9]+$','the seller sees the bag reference');
select throws_like($$select cancel_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.h1')::uuid)$$,'%HANDOVER_DECIDED%','a received handover cannot be cancelled');
-- Immutability, even for a privileged role.
reset role;
select throws_ok($$update seller_handovers set note='edited' where id=current_setting('test.h1')::uuid$$,'55000',null,'the announcement cannot be edited');
select throws_ok($$update seller_handovers set status='open' where id=current_setting('test.h1')::uuid$$,'55000',null,'status moves only inside the engine');
select throws_ok($$delete from handover_events where handover_id=current_setting('test.h1')::uuid$$,'55000',null,'events are immutable');
select * from finish();
rollback;
