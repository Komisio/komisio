begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('recordReturn'),'medium','returns are medium risk');
select is(komisio_private.operation_risk('adjustLedger'),'high','ledger adjustments are high risk');
select is(komisio_private.operation_risk('applyMarkdownBatch'),'low','markdown batches are low risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000231','kinds-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000232','kinds-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000231","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Kinds test','kinds-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@kinds.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Synthetic scarf','Accessories','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,10000);
-- Return proposal: validation, preflight, self-approval refused, executed by a second person.
select set_config('test.sale',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid,'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',20000)));
select set_config('test.line',(select id::text from sale_lines where sale_id=current_setting('test.sale')::uuid),true);
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'recordReturn',jsonb_build_object('saleLineId',current_setting('test.line'),'refundOre',10000,'reason','Half'),'agent',now()+interval '1 day')$$,'%PARTIAL_REFUND_UNSUPPORTED%','partial refund refused at proposal');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'recordReturn',jsonb_build_object('saleLineId',current_setting('test.line'),'refundOre',20000,'reason',''),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','reason required');
select set_config('test.op1',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op1')::uuid,'recordReturn',jsonb_build_object('saleLineId',current_setting('test.line'),'refundOre',20000,'reason','Customer regret'),'return-agent',now()+interval '1 day'),current_setting('test.op1')::uuid,'return proposed');
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op1')::uuid,'approved','')$$,'42501',null,'proposer cannot approve a medium-risk return');
-- Markdown batch: only due steps, whole batch or nothing.
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'applyMarkdownBatch',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'step',1))),'agent',now()+interval '1 day')$$,'%MARKDOWN_NOT_DUE%','a batch with an undue step is refused');
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=accepted_at-interval '15 days' where id=current_setting('test.i2')::uuid;
alter table public.items enable trigger items_immutable;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000231","role":"authenticated"}';
select set_config('test.op2',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op2')::uuid,'applyMarkdownBatch',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'step',1))),'markdown-agent',now()+interval '1 day'),current_setting('test.op2')::uuid,'due batch proposed');
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op2')::uuid,'approved','Looks right')$$,'low risk: the proposer may approve');
select is((select outcome from operation_decisions where operation_id=current_setting('test.op2')::uuid),'executed','batch executed');
select is((select price_ore from item_prices where item_id=current_setting('test.i2')::uuid order by seq desc limit 1),9000::bigint,'markdown applied through the batch');
-- Ledger adjustment: high risk, executed only when the approver may adjust.
select set_config('test.op3',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op3')::uuid,'adjustLedger',jsonb_build_object('sellerId',current_setting('test.seller'),'amountOre',-500,'reason','Label fee'),'ledger-agent',now()+interval '1 day'),current_setting('test.op3')::uuid,'adjustment proposed');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'adjustLedger',jsonb_build_object('sellerId',current_setting('test.seller'),'amountOre',0,'reason','Nothing'),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','zero adjustment refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000232','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000232","role":"authenticated"}';
select set_config('test.dec3',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec3')::uuid,current_setting('test.op3')::uuid,'approved','Staff tries');
select is((select outcome||'|'||error_code from operation_decisions where id=current_setting('test.dec3')::uuid),'failed|FORBIDDEN','staff approval of an adjustment fails at execution: owner or admin only');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,8000::bigint,'ledger untouched by the failed execution');
-- The staff member approves the return; the seller credit reverses.
select set_config('test.dec1',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op1')::uuid,'approved','Checked the garment');
select is((select outcome||'|'||result_id from operation_decisions where id=current_setting('test.dec1')::uuid),'executed|'||current_setting('test.op1'),'return executed with the operation id');
select is((select flagged_for_review from sale_returns where id=current_setting('test.op1')::uuid),false,'return recorded');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,0::bigint,'credit reversed by the approved return');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'recordReturn')),1::bigint,'queue filters the new kind');
select * from finish();
rollback;
