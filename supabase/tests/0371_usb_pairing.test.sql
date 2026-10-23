begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('a5920000-0000-4000-8000-000000000001','usb-owner@example.test',now(),false),
 ('a5920000-0000-4000-8000-000000000002','usb-staff@example.test',now(),false),
 ('a5920000-0000-4000-8000-000000000003',null,null,true),
 ('a5920000-0000-4000-8000-000000000004',null,null,true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.t',create_tenant('USB pairing','usb-pairing-test',gen_random_uuid())::text,true);
select set_config('test.p',gen_random_uuid()::text,true);
select register_printer(current_setting('test.t')::uuid,current_setting('test.p')::uuid,'USB test','usb','ZDesigner USB','ZD420',203,true);
select set_config('test.code',create_print_pairing_code(current_setting('test.t')::uuid,current_setting('test.p')::uuid)::text,true);
select ok(current_setting('test.code')::jsonb->>'code' ~ '^[A-F0-9]{5}-[A-F0-9]{5}$','USB gets ordinary single-use pairing code');
select ok((current_setting('test.code')::jsonb->>'expiresAt')::timestamptz=now()+interval '15 minutes','same 15 minute expiry');
select throws_ok($$select create_print_pairing_code(gen_random_uuid(),current_setting('test.p')::uuid)$$,'42501','FORBIDDEN','other tenant refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.t')::uuid,'a5920000-0000-4000-8000-000000000002','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select create_print_pairing_code(current_setting('test.t')::uuid,current_setting('test.p')::uuid)$$,'42501','FORBIDDEN','staff refused');
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}';
select set_config('test.device',pair_print_device(current_setting('test.code')::jsonb->>'code','Synthetic USB agent','1.1.0')::text,true);
select is(print_device_context()->>'transport','usb','paired context retains USB');
select is(current_setting('test.device')::jsonb->>'address','ZDesigner USB','exact local Windows queue retained');
select is(current_setting('test.device')::jsonb->>'printerId',current_setting('test.p'),'bound to intended printer');
select throws_ok($$select claim_print_job(current_setting('test.t')::uuid,gen_random_uuid())$$,'42501',null,'device cannot claim another printer');
select throws_ok($$select create_print_pairing_code(current_setting('test.t')::uuid,current_setting('test.p')::uuid)$$,'42501',null,'device cannot create another code');
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}';
select throws_like($$select pair_print_device(current_setting('test.code')::jsonb->>'code','Other','1.1.0')$$,'%PAIRING_CODE_INVALID%','used code cannot be replayed');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'a5920000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_ok($$select create_print_pairing_code(current_setting('test.t')::uuid,current_setting('test.p')::uuid)$$,'42501','AUTH_REQUIRED','owner MFA required');
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(revoke_print_device(current_setting('test.t')::uuid,(current_setting('test.device')::jsonb->>'deviceId')::uuid),true,'owner revokes USB device');
set local "request.jwt.claims"='{"sub":"a5920000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok($$select print_device_context()$$,'42501',null,'revoked USB device denied');
select * from finish();
rollback;
