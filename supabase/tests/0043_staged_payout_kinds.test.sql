begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('approvePayout'),'medium','payout approval is medium risk');
select is(komisio_private.operation_risk('markPayoutPaid'),'medium','marking paid is medium risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000261','payout-kinds-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000262','payout-kinds-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000261","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Payout kinds test','payout-kinds-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@payoutkinds.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,50000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',50000)));
select set_config('test.p1',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,10000);
-- Validation and preflight.
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'markPayoutPaid',jsonb_build_object('payoutId',current_setting('test.p1'),'reference','','reason',''),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','a payment needs a reference');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'approvePayout',jsonb_build_object('payoutId',current_setting('test.p1')),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','reason key required even when empty');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'approvePayout',jsonb_build_object('payoutId',gen_random_uuid(),'reason',''),'agent',now()+interval '1 day')$$,'%PAYOUT_NOT_FOUND%','unknown payout refused');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'markPayoutPaid',jsonb_build_object('payoutId',current_setting('test.p1'),'reference','BG 1','reason',''),'agent',now()+interval '1 day')$$,'%PAYOUT_NOT_APPROVED%','cannot propose paying an unapproved payout');
-- Approval proposal: proposer refused, second person executes, amount reserved.
select set_config('test.op1',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op1')::uuid,'approvePayout',jsonb_build_object('payoutId',current_setting('test.p1'),'reason','Balance checked'),'payout-agent',now()+interval '1 day'),current_setting('test.op1')::uuid,'approval proposed');
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op1')::uuid,'approved','')$$,'42501',null,'proposer cannot approve a payout approval');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000262','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000262","role":"authenticated"}';
select set_config('test.dec1',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op1')::uuid,'approved','Staff agrees');
select is((select outcome||'|'||result_id from operation_decisions where id=current_setting('test.dec1')::uuid),'executed|'||current_setting('test.op1'),'approval executed with the operation id as event id');
select is((select status||'|'||approved_by from payouts where id=current_setting('test.p1')::uuid),'approved|f0000000-0000-4000-8000-000000000262','payout approved by the approver, not the proposer');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'reservedOre')::bigint,10000::bigint,'amount reserved');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'approvePayout',jsonb_build_object('payoutId',current_setting('test.p1'),'reason',''),'agent',now()+interval '1 day')$$,'%PAYOUT_NOT_REQUESTED%','an approved payout cannot be proposed for approval again');
-- Payment proposal by staff, executed by the owner.
select set_config('test.op2',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op2')::uuid,'markPayoutPaid',jsonb_build_object('payoutId',current_setting('test.p1'),'reference','BG 123','reason','Paid this morning'),'payout-agent',now()+interval '1 day'),current_setting('test.op2')::uuid,'payment proposed');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000261","role":"authenticated"}';
select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op2')::uuid,'approved','');
select is((select status||'|'||payment_reference from payouts where id=current_setting('test.p1')::uuid),'paid|BG 123','payout paid with the reference');
select is((select reason from payout_events where id=current_setting('test.op2')::uuid),'Paid this morning','payment event carries the reason');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,10000::bigint,'paid amount left the balance');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'reservedOre')::bigint,0::bigint,'reservation released');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'executed',null,null,'markPayoutPaid')),1::bigint,'queue filters the payout kinds');
select * from finish();
rollback;
