begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000211','life-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000212','life-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000211","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Lifecycle test','lifecycle-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@life.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,20000);
-- Fresh item: on sale, nothing due (pilot steps at day 14, 28, 42).
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),'on_sale','fresh item is on sale');
select is((select period_end from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),(select accepted_at+interval '42 days' from items where id=current_setting('test.item')::uuid),'period end from the frozen sale period');
select throws_like($$select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,1)$$,'%MARKDOWN_NOT_DUE%','no markdown before day 14');
select throws_like($$select lifecycle_queue(current_setting('test.tenant')::uuid,'expired')$$,'%INVALID_INPUT%','unknown stage rejected');
-- Backdate acceptance 15 days by inserting a fixture item directly (privileged), so step one is due.
reset role;
-- Fixture only: the immutability trigger is lifted by the test superuser to simulate elapsed time.
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=accepted_at-interval '15 days' where id=current_setting('test.item')::uuid;
alter table public.items enable trigger items_immutable;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000211","role":"authenticated"}';
select is((select stage||'|'||due_step||'|'||due_percent from lifecycle_queue(current_setting('test.tenant')::uuid,'markdown_due') where item_id=current_setting('test.item')::uuid),'markdown_due|1|10','step one due after 14 days');
select throws_like($$select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,2)$$,'%MARKDOWN_NOT_DUE%','step two is not due yet');
select set_config('test.m1',gen_random_uuid()::text,true);
select is(apply_markdown(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,current_setting('test.item')::uuid,1),current_setting('test.m1')::uuid,'markdown applied');
select is(apply_markdown(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,current_setting('test.item')::uuid,1),current_setting('test.m1')::uuid,'replay');
select throws_like($$select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,1)$$,'%MARKDOWN_ALREADY_APPLIED%','a step applies once');
select is((select price_ore from item_prices where item_id=current_setting('test.item')::uuid order by set_at desc,id desc limit 1),18000::bigint,'10 percent off the accepted price');
select is((select reason from item_prices where item_id=current_setting('test.item')::uuid order by set_at desc,id desc limit 1),'markdown','price row says markdown');
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),'on_sale','back on sale after the markdown');
-- Extension moves the period end; ending needs a reason.
select set_config('test.e1',gen_random_uuid()::text,true);
select throws_like($$select extend_sale_period(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.item')::uuid,400,'Too long')$$,'%INVALID_INPUT%','extension bounded');
select throws_like($$select extend_sale_period(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.item')::uuid,7,'')$$,'%INVALID_INPUT%','extension reason required');
select is(extend_sale_period(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.item')::uuid,7,'Seller on holiday'),current_setting('test.e1')::uuid,'period extended');
select is((select period_end from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),(select accepted_at+interval '49 days' from items where id=current_setting('test.item')::uuid),'period end includes the extension');
-- Past the period: period_ended stage, then ending closes the item.
reset role;
-- Fixture only: the immutability trigger is lifted by the test superuser to simulate elapsed time.
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=accepted_at-interval '40 days' where id=current_setting('test.item')::uuid;
alter table public.items enable trigger items_immutable;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000211","role":"authenticated"}';
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),'markdown_due','later steps become due before the period question');
select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,2);
select is((select price_ore from item_prices where item_id=current_setting('test.item')::uuid order by set_at desc,id desc limit 1),15000::bigint,'25 percent off the accepted price, not compounded');
select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,3);
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),'period_ended','all steps applied and the period has passed');
select set_config('test.end',gen_random_uuid()::text,true);
select throws_like($$select end_sale_period(current_setting('test.tenant')::uuid,current_setting('test.end')::uuid,current_setting('test.item')::uuid,'discard')$$,'%INVALID_INPUT%','unknown end action rejected');
select is(end_sale_period(current_setting('test.tenant')::uuid,current_setting('test.end')::uuid,current_setting('test.item')::uuid,'charity','Left at the charity shelf'),current_setting('test.end')::uuid,'period ended');
select is(end_sale_period(current_setting('test.tenant')::uuid,current_setting('test.end')::uuid,current_setting('test.item')::uuid,'charity','Left at the charity shelf'),current_setting('test.end')::uuid,'replay');
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item')::uuid),'ended','ended');
select throws_like($$select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,1)$$,'%ITEM_ENDED%','no markdown after the end');
select throws_like($$select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','L-1',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',10000)))$$,'%ITEM_ENDED%','an ended item cannot be sold');
select is((select count(*) from item_events where item_id=current_setting('test.item')::uuid and kind in ('markdown_applied','period_extended','period_ended')),5::bigint,'three markdowns, one extension, one end as events');
-- A sold item leaves the work list as sold.
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Synthetic scarf','Accessories','Good');
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,10000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','L-2',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',10000)));
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item2')::uuid),'sold','sold item shows as sold');
select throws_like($$select extend_sale_period(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item2')::uuid,7,'No')$$,'%ITEM_NOT_ON_SALE%','a sold item has no period to extend');
select is((select count(*) from lifecycle_queue(current_setting('test.tenant')::uuid,'sold')),1::bigint,'stage filter');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000212','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000212","role":"authenticated"}';
select is((select count(*) from lifecycle_queue(current_setting('test.tenant')::uuid)),2::bigint,'readonly reads the queue');
select throws_ok($$select end_sale_period(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item2')::uuid,'return')$$,'42501',null,'readonly cannot act');
select * from finish();
rollback;
