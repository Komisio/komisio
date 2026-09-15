begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000961','device-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000962','device-staff@example.test',now());
-- The device is an anonymous auth user: no e-mail, is_anonymous in its token.
insert into auth.users(id,is_anonymous) values ('f0000000-0000-4000-8000-000000000963',true),('f0000000-0000-4000-8000-000000000964',true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000961","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Print devices','print-devices-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@devices.test','')::text,true);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',null)::text,true);
select set_config('test.printer',gen_random_uuid()::text,true);
select register_printer(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'Counter','tcp','192.168.1.49:9100','ZD420',203);
select throws_like($$select create_print_pairing_code(current_setting('test.tenant')::uuid,gen_random_uuid())$$,'%PRINTER_NOT_FOUND%','a code needs a network printer');
select set_config('test.pair',create_print_pairing_code(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)::text,true);
select matches(current_setting('test.pair')::jsonb->>'code','^[0-9A-F]{5}-[0-9A-F]{5}$','a ten character code');
select throws_ok($$select count(*) from print_pairing_codes$$,'42501',null,'members cannot read codes');
select is(print_devices(current_setting('test.tenant')::uuid),'[]'::jsonb,'no device yet');
-- A member cannot pair; only an anonymous device may.
select throws_ok($$select pair_print_device(current_setting('test.pair')::jsonb->>'code','Kassan',null)$$,'42501',null,'a person cannot pair as a device');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000963","role":"authenticated","is_anonymous":true}';
select throws_ok($$select print_device_context()$$,'42501',null,'an unpaired anonymous user has no session');
select throws_ok($$select claim_print_job(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)$$,'42501',null,'and cannot claim');
select throws_like($$select pair_print_device('ZZZZZ-ZZZZZ','Kassan','1.0.0')$$,'%PAIRING_CODE_INVALID%','a wrong code is refused');
select set_config('test.device',pair_print_device(current_setting('test.pair')::jsonb->>'code','Kassan','1.0.0')::text,true);
select is(current_setting('test.device')::jsonb->>'printerName','Counter','the device learns its printer');
select is(current_setting('test.device')::jsonb->>'address','192.168.1.49:9100','and its address');
select throws_like($$select pair_print_device(current_setting('test.pair')::jsonb->>'code','Kassan','1.0.0')$$,'%DEVICE_ALREADY_PAIRED%','a device pairs once');
select is(tenant_role(current_setting('test.tenant')::uuid),'device','the device holds the device role');
select is((select count(*) from user_tenant_ids()),0::bigint,'devices are outside the member tenant list');
select is((select count(*) from printers),0::bigint,'no printer rows through policies');
select is((select count(*) from print_jobs),0::bigint,'no job rows through policies');
select is((select count(*) from tenant_members),0::bigint,'no member rows through policies');
select is(print_device_context()->>'printerName','Counter','the device reads its printer through the function');
select lives_ok($$select report_print_device('{"version":"1.0.1","printerReachable":true,"error":""}'::jsonb)$$,'heartbeat recorded');
select throws_ok($$select create_print_pairing_code(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)$$,'42501',null,'a device cannot create codes');
select throws_ok($$select register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'X','x@devices.test','')$$,'42501',null,'a device cannot act as staff');
select throws_ok($$select shopify_order_status(current_setting('test.tenant')::uuid)$$,'42501',null,'a device reads no store data');
-- A second anonymous user cannot reuse the code.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000964","role":"authenticated","is_anonymous":true}';
select throws_like($$select pair_print_device(current_setting('test.pair')::jsonb->>'code','Annan','1.0.0')$$,'%PAIRING_CODE_INVALID%','a used code is dead');
-- The owner queues a label; the device claims and completes it.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000961","role":"authenticated"}';
select set_config('test.job',queue_print_job(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.printer')::uuid,'bag','zpl-v2','bag_receipt',current_setting('test.bag')::uuid,'^XA^FDK-1^FS^XZ',1)::text,true);
select is((print_devices(current_setting('test.tenant')::uuid)->0->>'printerReachable')::boolean,true,'the owner sees the heartbeat');
select is(print_devices(current_setting('test.tenant')::uuid)->0->>'version','1.0.1','and the version');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000963","role":"authenticated","is_anonymous":true}';
select is(claim_print_job(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)->>'jobId',current_setting('test.job'),'the device claims its printer job');
select is(complete_print_job(current_setting('test.tenant')::uuid,current_setting('test.job')::uuid,true,''),current_setting('test.job')::uuid,'and completes it');
select throws_ok($$select claim_print_job(current_setting('test.tenant')::uuid,gen_random_uuid())$$,'42501',null,'another printer is refused');
-- Revocation ends everything.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000961","role":"authenticated"}';
select is(revoke_print_device(current_setting('test.tenant')::uuid,(current_setting('test.device')::jsonb->>'deviceId')::uuid),true,'owner revokes');
select is(revoke_print_device(current_setting('test.tenant')::uuid,(current_setting('test.device')::jsonb->>'deviceId')::uuid),false,'revoking again changes nothing');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000963","role":"authenticated","is_anonymous":true}';
select throws_ok($$select print_device_context()$$,'42501',null,'a revoked device has no session');
select throws_ok($$select claim_print_job(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)$$,'42501',null,'and cannot claim');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000962','staff');
select throws_ok($$insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000964','device')$$,'55000',null,'device memberships come only from pairing');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000962","role":"authenticated"}';
select is(print_devices(current_setting('test.tenant')::uuid)->0->>'revokedAt' is not null,true,'staff see the revoked device');
select throws_ok($$select create_print_pairing_code(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)$$,'42501',null,'staff cannot create codes');
select * from finish();
rollback;
