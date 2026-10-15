begin;
\ir bag-reception-fixture.inc
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
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Blue wool jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'reception_review',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Red coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'reception_review',current_setting('test.d2')::uuid,1,30000);
select set_config('test.p',gen_random_uuid()::text,true);
select register_purchase(current_setting('test.tenant')::uuid,current_setting('test.p')::uuid,'Vintage lamp',15000,'Auction receipt 7',false);
select set_config('test.i3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid,'purchase',current_setting('test.p')::uuid,null,25000);

select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i2')::uuid,12345,'Synthetic current price');
select set_config('test.sheet',item_label_sheet_facts(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,null)::text,true);
select is(jsonb_array_length(current_setting('test.sheet')::jsonb->'items'),2,'all accepted intake items are included');
do $$ declare draft uuid; begin
 for n in 1..28 loop
  draft:=gen_random_uuid();
  perform pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,draft,0,'Synthetic extra item '||n,'Clothing','Good');
  perform accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'reception_review',draft,1,10000);
 end loop;
end $$;
select is(jsonb_array_length(item_label_sheet_facts(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,null)->'items'),30,'intake labels are not cut off at the list page boundary');
select is(item_label_sheet_facts(current_setting('test.tenant')::uuid,null,array[current_setting('test.i2')::uuid])->'items'->0->>'priceOre','12345','sheet uses current exact price');
select throws_ok($$select item_label_sheet_facts(current_setting('test.tenant')::uuid,null,array[gen_random_uuid()])$$,'P0001','ITEM_NOT_AVAILABLE','missing or foreign selections are never silently omitted');
select throws_ok($$select item_label_sheet_facts(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,array[current_setting('test.i2')::uuid])$$,'P0001','INVALID_INPUT','only one selection source');
select throws_ok($$select item_label_sheet_facts(current_setting('test.tenant')::uuid,null,array[]::uuid[])$$,'P0001','INVALID_INPUT','empty selection is rejected');
select throws_ok($$select item_label_sheet_facts(current_setting('test.tenant')::uuid,null,array_fill(current_setting('test.i2')::uuid,array[201]))$$,'P0001','INVALID_INPUT','bounded selection');
select is(jsonb_array_length(item_label_sheet_facts(current_setting('test.tenant')::uuid,null,array[current_setting('test.i2')::uuid,current_setting('test.i2')::uuid])->'items'),1,'duplicate selections do not print accidental copies');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000952','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000952","role":"authenticated"}';
select lives_ok($$select item_label_sheet_facts(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,null)$$,'readonly can print existing facts');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000953","role":"authenticated"}';
select throws_ok($$select item_label_sheet_facts(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,null)$$,'42501',null,'outsider is refused');
reset role;
select ok(not has_function_privilege('anon','public.item_label_sheet_facts(uuid,uuid,uuid[])','execute'),'anonymous execution denied');
select * from finish();
rollback;
