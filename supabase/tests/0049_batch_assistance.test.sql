begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('89000000-0000-4000-8000-000000000001','owner@assistance.test',now()),
 ('89000000-0000-4000-8000-000000000002','reader@assistance.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"89000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.a',create_tenant('Assistance A','batch-assistance-a',gen_random_uuid())::text,true);
select set_config('test.b',create_tenant('Assistance B','batch-assistance-b',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller','','123')::text,true);
select set_config('test.session',gen_random_uuid()::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.a')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid);
select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 '[{"id":"89000000-0000-4000-8000-000000000010","kind":"observation","reference":"test","observation":"Jacket"}]');
select throws_ok($$select reserve_reception_assistance(current_setting('test.b')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'P0001','RECEPTION_CHANGED','cross store session denied');
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','unreviewed-batch-v2')$$,'P0001','INVALID_INPUT','unknown prompt version denied');
select is(reserve_reception_assistance(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,1,'test-model','reception-batch-v1'),true,'batch attempt reserved');
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,1,'test-model','reception-v1')$$,'P0001','REQUEST_CONFLICT','single and batch attempts cannot share an id');
select is(reserve_reception_assistance(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,1,'test-model','reception-batch-v1'),false,'same request never invokes twice');
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,1,'different','reception-batch-v1')$$,'P0001','REQUEST_CONFLICT','payload binding');
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,2,'test-model','reception-batch-v1')$$,'P0001','RECEPTION_CHANGED','stale source denied');
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'P0001','ASSISTANCE_LIMIT','cooldown serializes new attempts');
select throws_ok($$delete from reception_assistance_attempts$$,'42501',null,'attempts cannot be deleted by user');
reset role;
insert into reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version,created_at)
select gen_random_uuid(),current_setting('test.a')::uuid,current_setting('test.session')::uuid,1,'89000000-0000-4000-8000-000000000001','test-model','reception-batch-v1',now()-interval '1 hour' from generate_series(1,10);
-- Remove only the fixture's current-time row before testing the rolling quota.
delete from reception_assistance_attempts where id=current_setting('test.request')::uuid;
set local role authenticated;
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'P0001','ASSISTANCE_LIMIT','ten attempts in rolling day is hard cap');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.a')::uuid,'89000000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"89000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'42501','FORBIDDEN','readonly cannot spend');
select is((select count(*)::int from reception_assistance_attempts where tenant_id=current_setting('test.a')::uuid),0,'readonly cannot read operational attempts');
set local "request.jwt.claims"='{"sub":"89000000-0000-4000-8000-000000000099","role":"authenticated"}';
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'42501',null,'unverified/nonmember rejected');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'89000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"89000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from reception_assistance_attempts where tenant_id=current_setting('test.a')::uuid),0,'MFA blocks operational reads');
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'42501',null,'MFA blocks reservation');
reset role;
update tenant_members set role='staff' where tenant_id=current_setting('test.a')::uuid and user_id='89000000-0000-4000-8000-000000000002';
select set_config('test.other_request',(select id::text from reception_assistance_attempts where tenant_id=current_setting('test.a')::uuid limit 1),true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"89000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select reserve_reception_assistance(current_setting('test.a')::uuid,current_setting('test.other_request')::uuid,current_setting('test.session')::uuid,1,'test-model','reception-batch-v1')$$,'P0001','REQUEST_CONFLICT','another staff actor cannot reuse original request');
select * from finish();
rollback;
