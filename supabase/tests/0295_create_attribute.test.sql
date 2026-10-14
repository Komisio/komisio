begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000002951','attribute-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000002952','attribute-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000002953','attribute-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002951","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Attribute settings','attribute-settings',gen_random_uuid())::text,true);
select create_invitation(current_setting('test.tenant')::uuid,'attribute-staff@example.test','staff',repeat('9',64));
select is(create_store_attribute(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002961','{"dataType":"number","unit":"cm","labels":{"en":"Length"}}'),
 'custom_f0000000000040008000000000002961','create a store field');
select is(create_store_attribute(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002961','{"dataType":"number","unit":"cm","labels":{"en":"Length"}}'),
 'custom_f0000000000040008000000000002961','exact replay returns the same field');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='attribute.defined'),1::bigint,'one audit event');
select throws_ok(format('select create_store_attribute(%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000002961','{"dataType":"text","labels":{"en":"Other"}}'),'P0001','REQUEST_CONFLICT','changed retry refused');
select set_attribute_definition(current_setting('test.tenant')::uuid,'custom_f0000000000040008000000000002961','{"dataType":"number","unit":"m","labels":{"en":"Length"}}');
select throws_ok(format('select create_store_attribute(%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000002961','{"dataType":"number","unit":"cm","labels":{"en":"Length"}}'),'P0001','REQUEST_CONFLICT','retry never overwrites a later version');
select is((select unit from attribute_definitions where tenant_id=current_setting('test.tenant')::uuid and slug='custom_f0000000000040008000000000002961' and version=1),'cm','old definition remains intact');
select throws_ok(format('select create_store_attribute(%L,%L,%L)',current_setting('test.tenant'),gen_random_uuid(),'{"dataType":"choice","labels":{"en":"Empty choice"}}'),'P0001','INVALID_INPUT','choice requires alternatives');
select throws_ok(format('select create_store_attribute(%L,%L,%L)',current_setting('test.tenant'),gen_random_uuid(),'{"dataType":"text","labels":{}}'),'P0001','INVALID_INPUT','a visible name is required');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002952","role":"authenticated"}';
select accept_invitation(repeat('9',64));
select throws_ok(format('select create_store_attribute(%L,%L,%L)',current_setting('test.tenant'),gen_random_uuid(),'{"dataType":"text","labels":{"en":"Denied"}}'),'42501','FORBIDDEN','staff cannot create fields');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002953","role":"authenticated"}';
select throws_ok(format('select create_store_attribute(%L,%L,%L)',current_setting('test.tenant'),gen_random_uuid(),'{"dataType":"text","labels":{"en":"Denied"}}'),'42501','FORBIDDEN','other tenants cannot create fields');
select ok(not has_function_privilege('anon','public.create_store_attribute(uuid,uuid,jsonb)','execute'),'anonymous calls denied');
select * from finish();
rollback;
