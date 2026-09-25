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
select set_config('test.label',item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid)::text,true);
select is(current_setting('test.label')::jsonb->>'title','Red coat','origin description is shown');
select is(current_setting('test.label')::jsonb->>'priceOre','12345','latest manual price is used, including same-transaction ordering');
select is(jsonb_typeof(current_setting('test.label')::jsonb->'priceOre'),'string','money stays exact through JSON');
select is(current_setting('test.label')::jsonb->>'currency','SEK','currency comes from store');
select is(current_setting('test.label')::jsonb->>'reference','I-'||upper(left(current_setting('test.i2'),8)),'existing item reference is preserved');
select is((select count(*)::int from jsonb_object_keys(current_setting('test.label')::jsonb)),5,'only label facts are returned');
select is(item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid)->>'title','Vintage lamp','purchase labels also resolve their description');
select is(item_label_facts(current_setting('test.tenant')::uuid,gen_random_uuid()),null::jsonb,'unknown item does not produce a label');
select set_config('test.other',create_tenant('Other label store','other-label-store',gen_random_uuid())::text,true);
select is(item_label_facts(current_setting('test.other')::uuid,current_setting('test.i2')::uuid),null::jsonb,'even an owner of both stores cannot mix tenant and item');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000952','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000952","role":"authenticated"}';
select lives_ok($$select item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid)$$,'read-only member reads existing facts');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000953","role":"authenticated"}';
select throws_ok($$select item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid)$$,'42501',null,'outsider cannot read label');
reset role;
select ok(not has_function_privilege('anon','public.item_label_facts(uuid,uuid)','execute'),'anonymous calls are denied');
select * from finish();
rollback;

