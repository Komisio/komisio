begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000003271','category-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000003272','category-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000003273','category-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003271","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Categories','categories-test','f0000000-0000-4000-8000-000000003274')::text,true);
select is((select count(*) from item_categories where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'new store starts with two categories');
select ok((select bool_and(labels ?& array['sv','en','no','dk','fi','de','es','it']) from item_categories where tenant_id=current_setting('test.tenant')::uuid),'starter category names cover every UI language');
select is(create_item_category(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003275','Books','{"sv":"Böcker","en":"Books"}'),'f0000000-0000-4000-8000-000000003275'::uuid,'owner creates translated category');
select is(create_item_category(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003275','Books','{"sv":"Böcker","en":"Books"}'),'f0000000-0000-4000-8000-000000003275'::uuid,'exact retry returns original category');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='category.created'),1::bigint,'one audit event');
select throws_ok($$select create_item_category(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003275','Other','{"en":"Other"}')$$,'P0001','REQUEST_CONFLICT','changed retry cannot overwrite a category');
select throws_ok($$select create_item_category(current_setting('test.tenant')::uuid,gen_random_uuid(),' books ','{"en":"Books"}')$$,'P0001','CATEGORY_EXISTS','duplicate names are refused ignoring case and surrounding spaces');
select throws_ok($$select create_item_category(current_setting('test.tenant')::uuid,gen_random_uuid(),'Empty','{}')$$,'P0001','INVALID_INPUT','labels cannot be empty');
select create_tenant('Categories','categories-test','f0000000-0000-4000-8000-000000003274');
select is((select count(*) from item_categories where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'tenant replay does not duplicate or reset categories');
select throws_ok($$insert into item_categories(tenant_id,name,labels) values(current_setting('test.tenant')::uuid,'Denied','{"en":"Denied"}')$$,'42501',null,'direct writes are denied');
select create_invitation(current_setting('test.tenant')::uuid,'category-staff@example.test','staff',repeat('7',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003272","role":"authenticated"}';
select accept_invitation(repeat('7',64));
select is((select count(*) from item_categories where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'staff can read categories');
select throws_ok($$select create_item_category(current_setting('test.tenant')::uuid,gen_random_uuid(),'Denied','{"en":"Denied"}')$$,'42501','FORBIDDEN','staff cannot register categories');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003273","role":"authenticated"}';
select is((select count(*) from item_categories where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'other stores cannot read categories');
select throws_ok($$select create_item_category(current_setting('test.tenant')::uuid,gen_random_uuid(),'Denied','{"en":"Denied"}')$$,'42501','FORBIDDEN','other stores cannot create categories');
select ok(not has_function_privilege('anon','public.create_item_category(uuid,uuid,text,jsonb)','execute'),'anonymous creation is denied');
select * from finish();
rollback;
