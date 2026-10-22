begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000005440','managed-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000005441','managed-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000005442','managed-device@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005440","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Managed setup','managed-setup-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other managed','managed-setup-other',gen_random_uuid())::text,true);
select set_config('test.printer',gen_random_uuid()::text,true);
select register_weblink_printer(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'Zebra','ZD420',203);
select is(authorize_weblink_setup(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,null),true,'owner authorizes setup without activating');
select is((select active from printers where id=current_setting('test.printer')::uuid),false,'authorization is read only');
select throws_like($$select authorize_weblink_setup(current_setting('test.other')::uuid,current_setting('test.printer')::uuid,null)$$,'%PRINTER_NOT_FOUND%','cross-tenant printer refused');
select throws_like($$select authorize_weblink_setup(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,gen_random_uuid())$$,'%DEVICE_NOT_FOUND%','unrelated device refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005441','staff');
insert into print_devices(id,tenant_id,printer_id,user_id,name,paired_by) values
 ('f0000000-0000-4000-8000-000000005443',current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'f0000000-0000-4000-8000-000000005442','Device','f0000000-0000-4000-8000-000000005440');
set local role authenticated;
select is(authorize_weblink_setup(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'f0000000-0000-4000-8000-000000005443'),true,'owner can obtain existing active device configuration');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005441","role":"authenticated"}';
select throws_ok($$select authorize_weblink_setup(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,null)$$,'42501',null,'staff cannot authorize setup');
reset role;
update tenant_members set role='admin' where user_id='f0000000-0000-4000-8000-000000005441';
set local role authenticated;
select is(authorize_weblink_setup(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,null),true,'admin may authorize');
select throws_ok($$select authorize_weblink_setup(current_setting('test.other')::uuid,current_setting('test.printer')::uuid,null)$$,'42501',null,'non-member cannot authorize');
select revoke_print_device(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005443');
select throws_like($$select authorize_weblink_setup(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'f0000000-0000-4000-8000-000000005443')$$,'%DEVICE_NOT_FOUND%','revoked credentials cannot be downloaded');
reset role;
set local role anon;
select throws_ok($$select authorize_weblink_setup(gen_random_uuid(),gen_random_uuid(),null)$$,'42501',null,'anonymous forbidden');
reset role;
select * from finish();
rollback;
