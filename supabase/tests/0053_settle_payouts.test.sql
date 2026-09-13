begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('settlePayouts'),'medium','a settlement batch is medium risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000311','settle-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000312','settle-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000311","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Settle test','settle-test',gen_random_uuid())::text,true);
select set_config('test.a',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller A','a@settle.test','')::text,true);
select set_config('test.b',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller B','b@settle.test','')::text,true);
select set_config('test.c',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller C','c@settle.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
-- One sold item each for A and C; B has no balance.
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.a')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag_a',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.a')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft_a',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag_a')::uuid,current_setting('test.draft_a')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item_a',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item_a')::uuid,'inspection_draft',current_setting('test.draft_a')::uuid,1,50000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item_a'),'priceOre',50000)));
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.c')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag_c',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.c')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft_c',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag_c')::uuid,current_setting('test.draft_c')::uuid,0,'Synthetic coat','Coats','Good');
select set_config('test.item_c',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item_c')::uuid,'inspection_draft',current_setting('test.draft_c')::uuid,1,80000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-2','2026-09-10T11:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item_c'),'priceOre',80000)));
select set_config('test.avail_a',(seller_balance(current_setting('test.tenant')::uuid,current_setting('test.a')::uuid)->>'availableOre'),true);
select set_config('test.avail_c',(seller_balance(current_setting('test.tenant')::uuid,current_setting('test.c')::uuid)->>'availableOre'),true);
select cmp_ok(current_setting('test.avail_a')::bigint,'>=',10000::bigint,'seller A has a settleable balance');
-- Candidates: A and C, above the default threshold, no open payout; B is absent.
select is((settlement_candidates(current_setting('test.tenant')::uuid)->>'thresholdOre')::bigint,10000::bigint,'default threshold is 100 SEK');
select is((select jsonb_agg(s->>'sellerId' order by s->>'name') from jsonb_array_elements(settlement_candidates(current_setting('test.tenant')::uuid)->'sellers') s),
 jsonb_build_array(current_setting('test.a'),current_setting('test.c')),'A and C are candidates, B is not');
select is((select (s->>'availableOre')::bigint from jsonb_array_elements(settlement_candidates(current_setting('test.tenant')::uuid)->'sellers') s where s->>'sellerId'=current_setting('test.a')),current_setting('test.avail_a')::bigint,'candidate carries the available balance');
select throws_ok($$select settlement_candidates(gen_random_uuid())$$,'42501',null,'another tenant denied');
-- Validation and preconditions, nothing written on failure.
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',current_setting('test.avail_a')::bigint)),'')$$,'%INVALID_INPUT%','a reason is required');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',10000),jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',10000)),'Twice')$$,'%INVALID_INPUT%','each seller once');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),'[]'::jsonb,'Empty')$$,'%INVALID_INPUT%','an empty batch is refused');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',gen_random_uuid(),'amountOre',10000)),'Unknown')$$,'%SELLER_NOT_FOUND%','unknown seller refused');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',5000)),'Low')$$,'%PAYOUT_BELOW_THRESHOLD%','below the threshold refused');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',current_setting('test.avail_a')::bigint),jsonb_build_object('sellerId',current_setting('test.b'),'amountOre',10000)),'Mixed')$$,'%PAYOUT_EXCEEDS_BALANCE%','one seller without balance refuses the whole batch');
select is((select count(*) from payouts where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'nothing written by refused batches');
select is((select count(*) from payout_batches where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'no batch row either');
-- A direct batch by the owner: A's full balance requested and approved in one step.
select set_config('test.batch',gen_random_uuid()::text,true);
select is(settle_payouts(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',current_setting('test.avail_a')::bigint)),'September settlement'),current_setting('test.batch')::uuid,'batch recorded');
select is((select status||'|'||amount_ore||'|'||request_source||'|'||approved_by from payouts where id=overlay(overlay(md5(current_setting('test.batch')||':'||current_setting('test.a')) placing '5' from 13) placing '8' from 17)::uuid),'approved|'||current_setting('test.avail_a')||'|staff|f0000000-0000-4000-8000-000000000311','payout derived from the batch, approved by the caller');
select is((select reason from payout_events where payout_id=overlay(overlay(md5(current_setting('test.batch')||':'||current_setting('test.a')) placing '5' from 13) placing '8' from 17)::uuid and kind='approved'),'September settlement','approval event carries the batch reason');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.a')::uuid)->>'reservedOre')::bigint,current_setting('test.avail_a')::bigint,'the whole balance is reserved');
select is((select payout_count||'|'||total_ore from payout_batches where id=current_setting('test.batch')::uuid),'1|'||current_setting('test.avail_a'),'batch row keeps count and total');
select is(settle_payouts(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',current_setting('test.avail_a')::bigint)),'September settlement'),current_setting('test.batch')::uuid,'replay returns the batch');
select is((select count(*) from payouts where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'replay wrote nothing');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',current_setting('test.avail_a')::bigint)),'Other reason')$$,'%REQUEST_CONFLICT%','same id with another payload conflicts');
select throws_like($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',10000)),'Again')$$,'%PAYOUT_PENDING%','a seller with an open payout cannot be settled again');
select is((select jsonb_agg(s->>'sellerId') from jsonb_array_elements(settlement_candidates(current_setting('test.tenant')::uuid)->'sellers') s),jsonb_build_array(current_setting('test.c')),'A left the candidates');
-- Staged batch for C: proposer refused, second person executes as themselves.
select set_config('test.op',gen_random_uuid()::text,true);
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'settlePayouts',jsonb_build_object('sellers',jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.c'),'amountOre',current_setting('test.avail_c')::bigint))),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','reason key required');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'settlePayouts',jsonb_build_object('reason','x','sellers',jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.a'),'amountOre',10000))),'agent',now()+interval '1 day')$$,'%PAYOUT_PENDING%','preflight refuses a seller with an open payout');
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op')::uuid,'settlePayouts',jsonb_build_object('reason','Weekly settlement','sellers',jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.c'),'amountOre',current_setting('test.avail_c')::bigint))),'settlement-agent',now()+interval '1 day'),current_setting('test.op')::uuid,'batch proposed');
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op')::uuid,'approved','')$$,'42501',null,'proposer cannot approve a settlement');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000312","role":"authenticated"}';
select throws_ok($$select settle_payouts(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('sellerId',current_setting('test.c'),'amountOre',10000)),'Outsider')$$,'42501',null,'a non-member cannot settle');
select throws_ok($$select settlement_candidates(current_setting('test.tenant')::uuid)$$,'42501',null,'a non-member cannot list candidates');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000312','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000312","role":"authenticated"}';
select set_config('test.dec',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec')::uuid,current_setting('test.op')::uuid,'approved','Checked the balances');
select is((select outcome||'|'||result_id from operation_decisions where id=current_setting('test.dec')::uuid),'executed|'||current_setting('test.op'),'settlement executed with the operation id as batch id');
select is((select created_by::text from payout_batches where id=current_setting('test.op')::uuid),'f0000000-0000-4000-8000-000000000312','batch recorded by the approver');
select is((select status||'|'||approved_by from payouts where id=overlay(overlay(md5(current_setting('test.op')||':'||current_setting('test.c')) placing '5' from 13) placing '8' from 17)::uuid),'approved|f0000000-0000-4000-8000-000000000312','C approved by the approver, not the proposer');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.c')::uuid)->>'reservedOre')::bigint,current_setting('test.avail_c')::bigint,'C reserved');
select is(jsonb_array_length(settlement_candidates(current_setting('test.tenant')::uuid)->'sellers'),0,'no candidates left');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'executed',null,null,'settlePayouts')),1::bigint,'queue filters the settlement kind');
-- The batch record is immutable, even for a privileged role.
reset role;
select throws_ok($$update payout_batches set reason='edited' where id=current_setting('test.batch')::uuid$$,'55000',null,'batch rows cannot be edited');
select throws_ok($$delete from payout_batches where id=current_setting('test.batch')::uuid$$,'55000',null,'batch rows cannot be deleted');
select * from finish();
rollback;
