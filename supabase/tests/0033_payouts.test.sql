begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000151','payout-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000152','payout-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000151","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Payout test','payout-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@payout.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,50000);
-- Nothing sold yet: nothing to pay.
select set_config('test.p1',gen_random_uuid()::text,true);
select throws_like($$select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,10000)$$,'%PAYOUT_EXCEEDS_BALANCE%','no balance, no request');
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','P-1','2026-09-13T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',50000)));
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,20000::bigint,'40 percent of 500 SEK available');
select throws_like($$select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,5000)$$,'%PAYOUT_BELOW_THRESHOLD%','below the policy minimum of 100 SEK');
select throws_like($$select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,20001)$$,'%PAYOUT_EXCEEDS_BALANCE%','more than available rejected');
select is(request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,10000),current_setting('test.p1')::uuid,'payout requested');
select is(request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,10000),current_setting('test.p1')::uuid,'request replay');
select throws_like($$select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,11000)$$,'%REQUEST_CONFLICT%','changed replay rejected');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,20000::bigint,'a request moves no money');
select is((select status from payouts where id=current_setting('test.p1')::uuid),'requested','status requested');
-- Paying before approval is refused; approval reserves.
select throws_like($$select mark_payout_paid(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,'BG 123')$$,'%PAYOUT_NOT_APPROVED%','cannot pay an unapproved payout');
select set_config('test.a1',gen_random_uuid()::text,true);
select is(approve_payout(current_setting('test.tenant')::uuid,current_setting('test.a1')::uuid,current_setting('test.p1')::uuid),current_setting('test.a1')::uuid,'approved');
select is(approve_payout(current_setting('test.tenant')::uuid,current_setting('test.a1')::uuid,current_setting('test.p1')::uuid),current_setting('test.a1')::uuid,'approval replay');
select throws_like($$select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid)$$,'%PAYOUT_NOT_REQUESTED%','second approval refused');
select set_config('test.bal',seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.bal')::jsonb->>'availableOre')::bigint,10000::bigint,'approval reserves the amount');
select is((current_setting('test.bal')::jsonb->>'reservedOre')::bigint,10000::bigint,'reserved shown separately');
-- A second request is bounded by what remains available.
select throws_like($$select request_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,15000)$$,'%PAYOUT_EXCEEDS_BALANCE%','reservation reduces what can be requested');
-- Payment needs a reference and settles the reservation.
select throws_like($$select mark_payout_paid(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,'   ')$$,'%INVALID_INPUT%','payment reference required');
select set_config('test.paid1',gen_random_uuid()::text,true);
select is(mark_payout_paid(current_setting('test.tenant')::uuid,current_setting('test.paid1')::uuid,current_setting('test.p1')::uuid,'BG 2026-09-13-1'),current_setting('test.paid1')::uuid,'paid');
select is(mark_payout_paid(current_setting('test.tenant')::uuid,current_setting('test.paid1')::uuid,current_setting('test.p1')::uuid,'BG 2026-09-13-1'),current_setting('test.paid1')::uuid,'payment replay');
select set_config('test.bal',seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.bal')::jsonb->>'availableOre')::bigint,10000::bigint,'available unchanged by payment');
select is((current_setting('test.bal')::jsonb->>'reservedOre')::bigint,0::bigint,'reservation released');
select is((current_setting('test.bal')::jsonb->>'paidOre')::bigint,10000::bigint,'paid recorded');
select is((select status||'|'||payment_reference from payouts where id=current_setting('test.p1')::uuid),'paid|BG 2026-09-13-1','status and reference stored');
select is((select count(*) from payout_events where payout_id=current_setting('test.p1')::uuid),3::bigint,'requested, approved, paid events');
select throws_like($$select reject_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,'Too late')$$,'%PAYOUT_DECIDED%','a paid payout cannot be rejected');
-- Rejecting an approved payout releases the reservation.
select set_config('test.p2',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p2')::uuid,current_setting('test.seller')::uuid,10000);
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p2')::uuid);
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,0::bigint,'everything reserved');
select reject_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p2')::uuid,'Seller asked to wait');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,10000::bigint,'rejection releases the reservation');
select is((select status from payouts where id=current_setting('test.p2')::uuid),'rejected','rejected');
select throws_like($$select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p2')::uuid)$$,'%PAYOUT_NOT_REQUESTED%','rejected payout cannot be approved');
select throws_like($$select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid())$$,'%PAYOUT_NOT_FOUND%','unknown payout');
select throws_ok($$update payouts set status='paid'$$,'42501',null,'direct update denied');
reset role;
select throws_like($$update payouts set status='paid' where id=current_setting('test.p2')::uuid$$,'%IMMUTABLE_PAYOUT%','privileged status change outside the engine refused');
select throws_like($$delete from payout_events where payout_id=current_setting('test.p1')::uuid$$,'%IMMUTABLE_PAYOUT%','events immutable');
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000152','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000152","role":"authenticated"}';
select is((select count(*) from payouts),2::bigint,'readonly reads payouts');
select throws_ok($$select request_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,10000)$$,'42501',null,'readonly cannot request');
select throws_ok($$select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p2')::uuid)$$,'42501',null,'readonly cannot approve');
select * from finish();
rollback;
