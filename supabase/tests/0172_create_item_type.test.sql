begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001b01','type-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000001b02','type-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000001b03','type-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001b01","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Create types','create-types',gen_random_uuid())::text,true);
select create_invitation(current_setting('test.tenant')::uuid,'type-staff@example.test','staff',repeat('e',64));
select is(create_item_type(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000001b11','Skjorta','sv','[{"slug":"description","expected":true,"sort":0}]'),
 'custom_f0000000000040008000000000001b11','creates a stable store type');
select is(create_item_type(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000001b11','Skjorta','sv','[{"slug":"description","expected":true,"sort":0}]'),
 'custom_f0000000000040008000000000001b11','replays exact creation');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='item_type.set'),1::bigint,'replay does not write twice');
select throws_ok(format('select create_item_type(%L,%L,%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000001b11','Other','sv','[{"slug":"description","expected":true,"sort":0}]'),'P0001','REQUEST_CONFLICT','changed retry is refused');
select set_item_type(current_setting('test.tenant')::uuid,'custom_f0000000000040008000000000001b11','{"labels":{"sv":"Edited","en":"Edited"},"attributes":[{"slug":"description","expected":true,"sort":0}]}');
select throws_ok(format('select create_item_type(%L,%L,%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000001b11','Skjorta','sv','[{"slug":"description","expected":true,"sort":0}]'),'P0001','REQUEST_CONFLICT','retry cannot overwrite a later edit');
select throws_ok(format('select create_item_type(%L,%L,%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000001b12','Type','sv','[{"slug":"missing_attribute","expected":true,"sort":0}]'),'P0001','INVALID_INPUT','unknown fields refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001b02","role":"authenticated"}';
select accept_invitation(repeat('e',64));
select throws_ok(format('select create_item_type(%L,%L,%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000001b13','Staff type','sv','[{"slug":"description","expected":true,"sort":0}]'),'42501','FORBIDDEN','staff cannot create types');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001b03","role":"authenticated"}';
select throws_ok(format('select create_item_type(%L,%L,%L,%L,%L)',current_setting('test.tenant'),'f0000000-0000-4000-8000-000000001b13','Foreign type','sv','[{"slug":"description","expected":true,"sort":0}]'),'42501','FORBIDDEN','another store cannot create types');
select ok(not has_function_privilege('anon','public.create_item_type(uuid,uuid,text,text,jsonb)','execute'),'anonymous calls denied');
select * from finish();
rollback;
