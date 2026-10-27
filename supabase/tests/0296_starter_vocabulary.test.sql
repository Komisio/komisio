begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000002961','starter-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000002962','starter-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002961","role":"authenticated"}';
select set_config('test.tenant',create_tenant_with_locale('Starter store','starter-store','f0000000-0000-4000-8000-000000002963','en')::text,true);
select set_config('test.vocabulary',attribute_vocabulary(current_setting('test.tenant')::uuid)::text,true);
select is((select array_agg(t->>'slug' order by t->>'slug') from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'types') t where (t->>'active')::boolean),array['jacket','trousers'],'new stores offer exactly the two starter types');
select is((select array_agg(d->>'slug' order by d->>'slug') from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'definitions') d where (d->>'active')::boolean and d->>'slug' not in ('category','description')),array['brand','color','condition','material','size'],'five active base attributes');
select is((select count(*) from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'types') t where (t->>'active')::boolean and (select array_agg(a->>'slug' order by a->>'slug') from jsonb_array_elements(t->'attributes') a)=array['brand','color','condition','material','size']),2::bigint,'both starter profiles inherit base fields; description is controlled by the store');
select is((select t->'labels'->>'en' from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'types') t where t->>'slug'='jacket'),'Jacket','English type label');
select is((select t->'labels'->>'sv' from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'types') t where t->>'slug'='trousers'),'Byxor','Swedish type label');
select is((select count(*) from (select d->'labels' labels from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'definitions') d where (d->>'active')::boolean union all select t->'labels' from jsonb_array_elements(current_setting('test.vocabulary')::jsonb->'types') t where (t->>'active')::boolean) x where not(labels ?& array['sv','en','no','dk','fi','de','es','it'])),0::bigint,'every starter name has all eight translations');
select is(create_tenant_with_locale('Starter store','starter-store','f0000000-0000-4000-8000-000000002963','en'),current_setting('test.tenant')::uuid,'creation retry returns the same store');
select is(attribute_vocabulary(current_setting('test.tenant')::uuid),current_setting('test.vocabulary')::jsonb,'creation retry neither duplicates nor resets defaults');
select set_item_type(current_setting('test.tenant')::uuid,'jacket','{"labels":{"en":"My jackets"},"attributes":[{"slug":"description","sort":1}]}');
select create_tenant('Starter store','starter-store','f0000000-0000-4000-8000-000000002963');
select is((select t->'labels'->>'en' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='jacket'),'My jackets','retry preserves later store customizations');
select is((select count(*) from item_types where tenant_id is null),0::bigint,'shared types are hidden from direct store reads');
select ok((select not has_function_privilege('authenticated',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='komisio_private' and p.proname='seed_store_vocabulary'),'initializer is not a callable user command');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002962","role":"authenticated"}';
select throws_ok(format('select attribute_vocabulary(%L)',current_setting('test.tenant')),'42501','FORBIDDEN','starter setup preserves tenant access control');
select * from finish();
rollback;
