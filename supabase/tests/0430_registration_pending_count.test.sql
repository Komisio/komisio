begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4300000-0000-4000-8000-000000000001','count-owner@example.test',now()),
 ('f4300000-0000-4000-8000-000000000002','count-seller@example.test',now()),
 ('f4300000-0000-4000-8000-000000000003','count-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4300000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic registration count','registration-count-test',gen_random_uuid()) as tenant \gset
select create_tenant('Other registration count','registration-count-other',gen_random_uuid()) as other \gset
select publish_seller_agreement(:'tenant',gen_random_uuid(),null,'Synthetic agreement','Synthetic legal text','en',true) as agreement \gset
select set_seller_registration(:'tenant',gen_random_uuid(),null,'enable');
select seller_registration_settings(:'tenant')->>'token' as token \gset
select is(pending_seller_registration_count(:'tenant'),0::bigint,'empty queue is zero');
select gen_random_uuid() as application \gset
set local "request.jwt.claims"='{"sub":"f4300000-0000-4000-8000-000000000002","role":"authenticated"}';
select submit_seller_registration(:'token',:'application','Synthetic applicant','000',:'agreement',null,true,null);
select throws_ok(format('select pending_seller_registration_count(%L)',:'tenant'),'42501','FORBIDDEN','applicant cannot read store counts');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f4300000-0000-4000-8000-000000000003','staff');
select is((select count(*) from access_events where tenant_id=:'tenant' and action='seller_registration.submitted'),1::bigint,'one existing submitted activity event');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4300000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(pending_seller_registration_count(:'tenant'),1::bigint,'staff sees exact pending count');
select throws_ok(format('select pending_seller_registration_count(%L)',:'other'),'42501','FORBIDDEN','other tenant remains private');
select review_seller_registration(:'tenant',gen_random_uuid(),:'application',false);
select is(pending_seller_registration_count(:'tenant'),0::bigint,'reviewed applications leave pending count');
reset role;
select is((select count(*) from access_events where tenant_id=:'tenant' and action='seller_registration.reviewed'),1::bigint,'one existing reviewed activity event');
update tenant_members set role='readonly' where tenant_id=:'tenant' and user_id='f4300000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok(format('select pending_seller_registration_count(%L)',:'tenant'),'42501','FORBIDDEN','readonly cannot read counts');
reset role;
update tenant_members set role='admin' where tenant_id=:'tenant' and user_id='f4300000-0000-4000-8000-000000000003';
set local role authenticated;
select is(pending_seller_registration_count(:'tenant'),0::bigint,'admin can read counts');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f4300000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_ok(format('select pending_seller_registration_count(%L)',:'tenant'),'42501','AUTH_REQUIRED','count requires existing MFA');
set local "request.jwt.claims"='{"sub":"f4300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(pending_seller_registration_count(:'tenant'),0::bigint,'verified owner can read counts');
select is(pending_seller_registration_count(:'other'),0::bigint,'other store count excludes this store applications');
set local role anon;
select throws_ok(format('select pending_seller_registration_count(%L)',:'tenant'),'42501',null,'anonymous calls denied');
select * from finish();
rollback;
