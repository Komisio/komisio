begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000951','io-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000952','io-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000000953','io-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000951","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Items overview test','items-overview-test',gen_random_uuid())::text,true);
select set_config('test.s1',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','anna@io.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Blue wool jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Red coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,30000);
select set_config('test.p',gen_random_uuid()::text,true);
select register_purchase(current_setting('test.tenant')::uuid,current_setting('test.p')::uuid,'Vintage lamp',15000,'Auction receipt 7',false);
select set_config('test.i3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid,'purchase',current_setting('test.p')::uuid,null,25000);

select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i2')::uuid,12345,'Synthetic current price');
select set_config('test.edit',gen_random_uuid()::text,true);
select lives_ok($$select edit_item_description(current_setting('test.tenant')::uuid,current_setting('test.edit')::uuid,current_setting('test.i2')::uuid,'Red coat','Red wool coat')$$,'description correction is supported');
select is(item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid)->>'title','Red wool coat','current labels use correction');
select lives_ok($$select edit_item_description(current_setting('test.tenant')::uuid,current_setting('test.edit')::uuid,current_setting('test.i2')::uuid,'Red coat','Red wool coat')$$,'exact retry remains safe');
select throws_ok($$select edit_item_description(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i2')::uuid,'Red coat','Overwrite')$$,'P0001','ITEM_CHANGED','stale edits do not overwrite');
select is((select description from inspection_draft_revisions where tenant_id=current_setting('test.tenant')::uuid and draft_id=current_setting('test.d2')::uuid),'Red coat','accepted evidence is untouched');
select * from finish();
rollback;
