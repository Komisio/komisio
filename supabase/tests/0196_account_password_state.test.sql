begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,encrypted_password,raw_user_meta_data) values
 ('b2000000-0000-4000-8000-000000000001','passwordless@example.test',now(),null,'{"has_password":true}'),
 ('b2000000-0000-4000-8000-000000000002','password-present@example.test',now(),'synthetic-password-hash','{}'),
 ('b2000000-0000-4000-8000-000000000003','unverified-password@example.test',null,'synthetic-password-hash','{}');
set local role anon;
select throws_like($$select current_user_has_password()$$,'%permission denied%','anonymous callers cannot query account state');
set local role authenticated;
set local "request.jwt.claims"='{"role":"authenticated"}';
select throws_like($$select current_user_has_password()$$,'%AUTH_REQUIRED%','missing identity is rejected');
set local "request.jwt.claims"='{"sub":"b2000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(current_user_has_password(),false,'own null password needs setup regardless of metadata or another account');
select throws_like($$select encrypted_password from auth.users$$,'%permission denied%','password hashes remain inaccessible');
reset role;
update auth.users set encrypted_password='' where id='b2000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(current_user_has_password(),false,'own empty password needs setup');
set local "request.jwt.claims"='{"sub":"b2000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(current_user_has_password(),true,'existing password requires no setup');
set local "request.jwt.claims"='{"sub":"b2000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like($$select current_user_has_password()$$,'%AUTH_REQUIRED%','unverified account cannot read state');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values
 ('b2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"b2000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select throws_like($$select current_user_has_password()$$,'%AUTH_REQUIRED%','MFA is independently required');
set local "request.jwt.claims"='{"sub":"b2000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is(current_user_has_password(),true,'verified MFA session can read only its own state');
reset role;
insert into auth.users(id,email,encrypted_password,raw_user_meta_data,raw_app_meta_data) values
 ('b2000000-0000-4000-8000-000000000005','otp-signup@example.test','random-otp-password','{"komisio_activation_signup":true}','{"provider":"email"}');
update auth.users set email_confirmed_at=now() where id='b2000000-0000-4000-8000-000000000005';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"b2000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(current_user_has_password(),false,'OTP-generated password still requires the first user choice after confirmation');
reset role;
update auth.users set raw_user_meta_data='{"komisio_activation_signup":false,"komisio_password_setup_pending":false}' where id='b2000000-0000-4000-8000-000000000005';
set local role authenticated;
select is(current_user_has_password(),false,'editable metadata cannot complete password setup');
select throws_like($$update auth.users set raw_app_meta_data='{}'$$,'%permission denied%','protected setup state cannot be edited directly');
reset role;
update auth.users set encrypted_password='chosen-password-hash' where id='b2000000-0000-4000-8000-000000000005';
select is((select raw_app_meta_data->>'provider' from auth.users where id='b2000000-0000-4000-8000-000000000005'),'email','setup tracking preserves unrelated Auth metadata');
update auth.users set raw_user_meta_data='{"komisio_activation_signup":true,"komisio_password_setup_pending":true}' where id='b2000000-0000-4000-8000-000000000005';
set local role authenticated;
select is(current_user_has_password(),true,'chosen password stays established despite a repeated signup hint');
select * from finish();
rollback;
