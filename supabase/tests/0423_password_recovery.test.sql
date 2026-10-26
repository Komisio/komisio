begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
 ('f0000000-0000-4000-8000-000000000241','recovery-fixture@example.test',now(),'synthetic-old-hash');
insert into auth.sessions(id,user_id) values
 ('f0000000-0000-4000-8000-000000000242','f0000000-0000-4000-8000-000000000241');
update auth.users set recovery_token='synthetic-token',recovery_sent_at=now() where id='f0000000-0000-4000-8000-000000000241';
select isnt((select raw_app_meta_data->>'komisio_password_recovery_pending' from auth.users where id='f0000000-0000-4000-8000-000000000241'),'true','request alone cannot interrupt existing sessions');
update auth.users set recovery_token='' where id='f0000000-0000-4000-8000-000000000241';
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) values
 ('f0000000-0000-4000-8000-000000000243','f0000000-0000-4000-8000-000000000242','otp',now(),now());
select isnt((select raw_app_meta_data->>'komisio_password_recovery_pending' from auth.users where id='f0000000-0000-4000-8000-000000000241'),'true','magic link token clearing does not require a password change');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) values
 ('f0000000-0000-4000-8000-000000000244','f0000000-0000-4000-8000-000000000242','recovery',now(),now());
select is((select raw_app_meta_data->>'komisio_password_recovery_pending' from auth.users where id='f0000000-0000-4000-8000-000000000241'),'true','verified recovery session requires password choice');
update auth.users set raw_user_meta_data='{"komisio_password_recovery_pending":false}' where id='f0000000-0000-4000-8000-000000000241';
select is((select raw_app_meta_data->>'komisio_password_recovery_pending' from auth.users where id='f0000000-0000-4000-8000-000000000241'),'true','user-editable metadata cannot clear recovery requirement');
update auth.users set raw_app_meta_data='{"provider":"email"}' where id='f0000000-0000-4000-8000-000000000241';
select is((select raw_app_meta_data->>'komisio_password_recovery_pending' from auth.users where id='f0000000-0000-4000-8000-000000000241'),'true','Auth provider metadata refresh preserves requirement');
update auth.users set encrypted_password='synthetic-new-hash' where id='f0000000-0000-4000-8000-000000000241';
select isnt((select raw_app_meta_data->>'komisio_password_recovery_pending' from auth.users where id='f0000000-0000-4000-8000-000000000241'),'true','actual password change clears requirement');
select * from finish();
rollback;

