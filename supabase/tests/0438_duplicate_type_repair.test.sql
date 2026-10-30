begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d4380000-0000-4000-8000-000000000001','duplicate-type-owner@example.test',now()),
 ('d4380000-0000-4000-8000-000000000002','duplicate-type-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d4380000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Synthetic duplicate repair','duplicate-type-repair',gen_random_uuid())::text,true);
-- Existing engine settings can contain overlapping translations (including old imports).
select set_item_type(current_setting('test.tenant')::uuid,'repair_one','{"labels":{"sv":"Testjacka","en":"Test jacket"},"active":true,"attributes":[{"slug":"description","expected":true,"sort":0}]}');
select set_item_type(current_setting('test.tenant')::uuid,'repair_two','{"labels":{"sv":"Testjacka","en":"Test jacket"},"active":true,"attributes":[{"slug":"description","expected":true,"sort":0}]}');
select set_item_type(current_setting('test.tenant')::uuid,'repair_unique','{"labels":{"sv":"Testbyxa","en":"Test trousers"},"active":true,"attributes":[{"slug":"description","expected":true,"sort":0}]}');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"vatModeStoreOwned":"store_full"}');
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic duplicate jacket',10000,'Synthetic receipt',false)::text,true);
select set_config('test.item',accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,20000)::text,true);
select classify_items(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',current_setting('test.item'),'version',0)),'repair_two',null);
select classify_items(current_setting('test.tenant')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',current_setting('test.item'),'version',1)),'repair_one',null);
select set_config('test.snapshot',(select value::text from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') where value->>'slug'='repair_two'),true);
select set_config('test.rename','{"labels":{"sv":"Testjacka gammal","en":"Test jacket"},"active":true,"inheritAttributes":false,"suggestedCategoryId":null,"attributes":[{"slug":"description","expected":true,"sort":0}]}',true);
select lives_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb)$$,'rename one translation despite unchanged collision in another');
select lives_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb)$$,'exact rename retry returns the current result');
select throws_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb||'{"active":false}')$$,'P0001','CATALOGUE_CHANGED','stale different edit stays rejected');
select set_config('test.snapshot',(select value::text from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') where value->>'slug'='repair_two'),true);
select throws_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb||'{"labels":{"sv":"Testbyxa","en":"Test jacket"}}')$$,'P0001','ITEM_TYPE_NAME_EXISTS','new collision is still rejected');
select throws_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb||'{"labels":{"sv":"Testjacka gammal","en":"Test jacket","de":"Test jacket"}}')$$,'P0001','ITEM_TYPE_NAME_EXISTS','existing collision cannot spread to another translation');
select lives_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb||'{"active":false}')$$,'used duplicate can be retired without renaming every translation');
select lives_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb||'{"active":false}')$$,'exact retirement retry succeeds');
select is((select value->>'active' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') where value->>'slug'='repair_two'),'false','retired type is inactive');
select is(delete_catalogue_record(current_setting('test.tenant')::uuid,'type','repair_two')->>'ok','false','historical classification still protects type after current items move');
select set_config('test.snapshot',(select value::text from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') where value->>'slug'='repair_two'),true);
select throws_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb)$$,'P0001','ITEM_TYPE_NAME_EXISTS','reactivation cannot restore a colliding name');
select lives_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb||'{"labels":{"sv":"Testjacka gammal","en":"Old test jacket"}}')$$,'unique names allow explicit reactivation');
set local "request.jwt.claims"='{"sub":"d4380000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select update_item_type(current_setting('test.tenant')::uuid,'repair_two',current_setting('test.snapshot')::jsonb,current_setting('test.rename')::jsonb)$$,'42501','FORBIDDEN','outsider cannot repair store types');
reset role;
select * from finish();
rollback;
