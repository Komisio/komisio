begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000171','return-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000172','return-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000171","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Return test','return-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@return.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,50000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',15000,'Receipt 1',false)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,20000);
select set_config('test.sale',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid,'manual','R-1','2026-09-10T10:00:00Z','SEK',
 jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',50000),jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',20000)));
select set_config('test.line1',(select id::text from sale_lines where sale_id=current_setting('test.sale')::uuid and line_no=1),true);
select set_config('test.line2',(select id::text from sale_lines where sale_id=current_setting('test.sale')::uuid and line_no=2),true);
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,20000::bigint,'seller credited 200 SEK');
-- Validation.
select set_config('test.ret1',gen_random_uuid()::text,true);
select throws_like($$select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,current_setting('test.line1')::uuid,25000,'Half back')$$,'%PARTIAL_REFUND_UNSUPPORTED%','partial refunds rejected');
select throws_like($$select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,current_setting('test.line1')::uuid,50000,'')$$,'%INVALID_INPUT%','reason required');
select throws_like($$select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,gen_random_uuid(),50000,'Unknown')$$,'%SALE_LINE_NOT_FOUND%','unknown line rejected');
select throws_like($$select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,current_setting('test.line1')::uuid,50000,'Too early','2026-09-10T09:00:00Z')$$,'%INVALID_INPUT%','return before the sale rejected');
-- Full return of the consignment line reverses the credit and frees the item.
select is(record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,current_setting('test.line1')::uuid,50000,'Customer regret','2026-09-11T10:00:00Z'),current_setting('test.ret1')::uuid,'return recorded');
select is(record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,current_setting('test.line1')::uuid,50000,'Customer regret','2026-09-11T10:00:00Z'),current_setting('test.ret1')::uuid,'replay');
select throws_like($$select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret1')::uuid,current_setting('test.line1')::uuid,50000,'Other reason')$$,'%REQUEST_CONFLICT%','changed replay rejected');
select throws_like($$select record_return(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.line1')::uuid,50000,'Again')$$,'%LINE_ALREADY_RETURNED%','a line returns once');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,0::bigint,'credit reversed');
select is((select count(*) from seller_ledger_entries where kind='credit_reversal' and reference_id=current_setting('test.ret1')::uuid),1::bigint,'reversal references the return');
select is((select flagged_for_review from sale_returns where id=current_setting('test.ret1')::uuid),false,'nothing was paid out: no flag');
select is((select count(*) from item_events where item_id=current_setting('test.item1')::uuid and kind='returned'),1::bigint,'item marked returned');
select is((select status from sales where id=current_setting('test.sale')::uuid),'completed','the sale row is untouched');
select lives_ok($$select simulate_sale(current_setting('test.tenant')::uuid,jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',45000)))$$,'a returned item can be sold again');
-- Store line: no ledger movement, still a return fact.
select set_config('test.ret2',gen_random_uuid()::text,true);
select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret2')::uuid,current_setting('test.line2')::uuid,20000,'Defect');
select is((select count(*) from seller_ledger_entries),2::bigint,'store-owned return writes no ledger entry');
-- Flag when the credit was already reserved by an approved payout.
select set_config('test.sale2',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.sale2')::uuid,'manual','R-2','2026-09-12T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',45000)));
select set_config('test.line3',(select id::text from sale_lines where sale_id=current_setting('test.sale2')::uuid and line_no=1),true);
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,18000::bigint,'resale credits again');
select set_config('test.payout',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.payout')::uuid,current_setting('test.seller')::uuid,18000);
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.payout')::uuid);
select set_config('test.ret3',gen_random_uuid()::text,true);
select record_return(current_setting('test.tenant')::uuid,current_setting('test.ret3')::uuid,current_setting('test.line3')::uuid,45000,'Returned after payout approval','2026-09-13T00:30:00Z');
select is((select flagged_for_review||'|'||flag_reason from sale_returns where id=current_setting('test.ret3')::uuid),'true|CREDIT_ALREADY_USED','flagged when the credit was already reserved');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,-18000::bigint,'balance shows the shortfall for a person to resolve');
select throws_ok($$update sale_returns set flagged_for_review=false$$,'42501',null,'direct update denied');
reset role;
select throws_like($$update sale_returns set flagged_for_review=false where id=current_setting('test.ret3')::uuid$$,'%IMMUTABLE_SALE%','privileged update immutable');
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000172','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000172","role":"authenticated"}';
select is((select count(*) from sale_returns),3::bigint,'readonly reads returns');
select throws_ok($$select record_return(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.line2')::uuid,20000,'No')$$,'42501',null,'readonly cannot return');
select * from finish();
rollback;
