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


select is(jsonb_array_length(item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid)->'attributes'),1,'label includes populated condition, excluding title and category');
select is(item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid)->'attributes'->0->>'value','Good','label retains exact attribute value');
select is((stock_assortment_report(current_setting('test.tenant')::uuid,null)->'groups'->0->>'inStock')::int,3,'unassigned inventory is counted');
select set_config('test.group',create_assortment_group(current_setting('test.tenant')::uuid,gen_random_uuid(),'Standard')::text,true);
select classify_items(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',current_setting('test.i1'),'version',0)),null,current_setting('test.group')::uuid);
select is((select (g->>'inStock')::int from jsonb_array_elements(stock_assortment_report(current_setting('test.tenant')::uuid,null)->'groups') g where g->>'id'=current_setting('test.group')),1,'stock follows current assortment');
select is((select (g->>'stockValueOre')::bigint from jsonb_array_elements(stock_assortment_report(current_setting('test.tenant')::uuid,null)->'groups') g where g->>'id'=current_setting('test.group')),20000::bigint,'group value uses current price in ore');
select is((stock_assortment_report(current_setting('test.tenant')::uuid,'store')->'groups'->0->>'inStock')::int,1,'ownership filter includes only store inventory');
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid)::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
select set_config('test.received',quick_receive_classified(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.s1')::uuid,0,'{"description":"Synthetic trousers","brand":"Synthetic brand","color":"Blue","size":"M","material":"Wool"}',15000,null,'trousers',current_setting('test.group')::uuid)::text,true);
select is(item_classifications(current_setting('test.tenant')::uuid,array[(current_setting('test.received')::jsonb->>'itemId')::uuid])->0->>'assortment',current_setting('test.group'),'reception assigns group atomically');
select is(jsonb_array_length(item_label_facts(current_setting('test.tenant')::uuid,(current_setting('test.received')::jsonb->>'itemId')::uuid)->'attributes'),4,'four populated attributes reach labels');
select lives_ok($$select quick_receive_classified(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.s1')::uuid,0,'{"description":"Synthetic trousers","brand":"Synthetic brand","color":"Blue","size":"M","material":"Wool"}',15000,null,'trousers',current_setting('test.group')::uuid)$$,'same request safely replays');
select throws_ok($$select quick_receive_classified(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.s1')::uuid,0,'{"description":"Synthetic trousers"}',15000,null,'trousers',null)$$,'P0001','REQUEST_CONFLICT','retry cannot change group');
select set_config('test.session2',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid)::text,true);
select throws_ok($$select quick_receive_classified(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,current_setting('test.s1')::uuid,0,'{"description":"Synthetic invalid group"}',15000,null,null,gen_random_uuid())$$,'P0001','GROUP_NOT_FOUND','missing group refuses whole reception');
select is((select count(*) from items where origin_id=current_setting('test.session2')::uuid),0::bigint,'failed classification leaves no item');
select throws_ok($$select stock_assortment_report(current_setting('test.tenant')::uuid,'unknown')$$,'P0001','INVALID_INPUT','ownership must be valid');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000953","role":"authenticated"}';
select throws_ok($$select stock_assortment_report(current_setting('test.tenant')::uuid,null)$$,'42501','FORBIDDEN','outsider cannot read stock');
select throws_ok($$select item_label_facts(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid)$$,'42501','FORBIDDEN','outsider cannot read label attributes');
select throws_ok($$select quick_receive_classified(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,current_setting('test.s1')::uuid,0,'{"description":"Synthetic"}',15000,null,null,null)$$,'42501','FORBIDDEN','outsider cannot receive');
select * from finish();
rollback;
