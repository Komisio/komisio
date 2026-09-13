begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('updateStoreProfile'),'low','a profile update is low risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000331','profile-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000332','profile-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000331","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Profile test','profile-test',gen_random_uuid())::text,true);
select set_config('test.profile',$j${"address":{"street":"Storgatan 1","postalCode":"111 22","city":"Stockholm"},"contact":{"email":"hej@example.test","phone":"08-123","website":"https://example.test"},"openingHours":[{"day":"mon","opens":"10:00","closes":"18:00"},{"day":"sat","opens":"11:00","closes":"15:00"}],"accepts":"Clean, whole garments in season.","concept":"Second hand for grown-ups.","language":"sv"}$j$,true);
select is((current_store_profile(current_setting('test.tenant')::uuid)->>'version')::int,0,'no profile yet');
select is(public_store_profile('profile-test'),null,'public read is null without a profile');
-- Validation.
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.profile')::jsonb||'{"extra":1}')$$,'%INVALID_INPUT%','unknown key refused');
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,jsonb_set(current_setting('test.profile')::jsonb,'{contact,website}','"http://plain.test"'))$$,'%INVALID_INPUT%','website must be https');
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,jsonb_set(current_setting('test.profile')::jsonb,'{openingHours}','[{"day":"mon","opens":"10:00","closes":"09:00"}]'))$$,'%INVALID_INPUT%','closing before opening refused');
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,jsonb_set(current_setting('test.profile')::jsonb,'{openingHours}','[{"day":"mon","opens":"10:00","closes":"18:00"},{"day":"mon","opens":"10:00","closes":"18:00"}]'))$$,'%INVALID_INPUT%','each day once');
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,jsonb_set(current_setting('test.profile')::jsonb,'{language}','"de"'))$$,'%INVALID_INPUT%','language sv or en');
-- Publish, replay, conflict, stale.
select set_config('test.v1',gen_random_uuid()::text,true);
select is(publish_store_profile(current_setting('test.tenant')::uuid,current_setting('test.v1')::uuid,null,current_setting('test.profile')::jsonb),current_setting('test.v1')::uuid,'first version published');
select is(publish_store_profile(current_setting('test.tenant')::uuid,current_setting('test.v1')::uuid,null,current_setting('test.profile')::jsonb),current_setting('test.v1')::uuid,'replay returns the version');
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,current_setting('test.v1')::uuid,null,jsonb_set(current_setting('test.profile')::jsonb,'{concept}','"Other"'))$$,'%REQUEST_CONFLICT%','same id with another profile conflicts');
select throws_like($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.profile')::jsonb)$$,'%PROFILE_CHANGED%','publishing without naming the current version is refused');
select is((current_store_profile(current_setting('test.tenant')::uuid)->>'version')::int,1,'current version is 1');
select is(current_store_profile(current_setting('test.tenant')::uuid)->'profile',current_setting('test.profile')::jsonb,'profile stored as given');
-- Public read by slug, also as anon; nothing but name, slug and profile.
select is(public_store_profile('profile-test')->>'name','Profile test','public read by slug');
select is(public_store_profile('profile-test')->'profile'->>'city',null,'no flattening, the profile is nested');
select is((select array_agg(k order by k) from jsonb_object_keys(public_store_profile('profile-test')) k),array['name','profile','publishedAt','slug','version'],'public keys only');
set local role anon;
select is(public_store_profile('profile-test')->'profile'->>'concept','Second hand for grown-ups.','anon reads the public profile');
select is(public_store_profile('no-such-store'),null,'unknown slug is null, not an error');
select throws_ok($$select current_store_profile(current_setting('test.tenant')::uuid)$$,'42501',null,'anon cannot use the member read');
set local role authenticated;
-- Staff cannot publish; a staged proposal by staff executes only for an owner or admin approver.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000332','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000332","role":"authenticated"}';
select throws_ok($$select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.v1')::uuid,current_setting('test.profile')::jsonb)$$,'42501',null,'staff cannot publish');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'updateStoreProfile',jsonb_build_object('expectedCurrentId',null,'profile',current_setting('test.profile')::jsonb),'agent',now()+interval '1 day')$$,'%PROFILE_CHANGED%','preflight refuses a stale expected version');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'updateStoreProfile',jsonb_build_object('profile',current_setting('test.profile')::jsonb),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','expectedCurrentId key required');
select set_config('test.op',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op')::uuid,'updateStoreProfile',jsonb_build_object('expectedCurrentId',current_setting('test.v1'),'profile',jsonb_set(current_setting('test.profile')::jsonb,'{concept}','"Updated by the agent"')),'profile-agent',now()+interval '1 day'),current_setting('test.op')::uuid,'update proposed by staff');
select set_config('test.dec1',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op')::uuid,'approved','Staff tries');
select is((select outcome||'|'||error_code from operation_decisions where id=current_setting('test.dec1')::uuid),'failed|FORBIDDEN','staff approval records a failed outcome');
select is((current_store_profile(current_setting('test.tenant')::uuid)->>'version')::int,1,'nothing published by the failed approval');
-- The owner proposes and approves a low-risk update in the same session.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000331","role":"authenticated"}';
select set_config('test.op2',gen_random_uuid()::text,true);
select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op2')::uuid,'updateStoreProfile',jsonb_build_object('expectedCurrentId',current_setting('test.v1'),'profile',jsonb_set(current_setting('test.profile')::jsonb,'{concept}','"Updated by the agent"')),'profile-agent',now()+interval '1 day');
select set_config('test.dec2',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec2')::uuid,current_setting('test.op2')::uuid,'approved','');
select is((select outcome||'|'||result_id from operation_decisions where id=current_setting('test.dec2')::uuid),'executed|'||current_setting('test.op2'),'owner approval publishes with the operation id');
select is(current_store_profile(current_setting('test.tenant')::uuid)->'profile'->>'concept','Updated by the agent','version 2 carries the proposed text');
select is((current_store_profile(current_setting('test.tenant')::uuid)->>'version')::int,2,'version 2');
select is((select previous_id from store_profile_versions where id=current_setting('test.op2')::uuid),current_setting('test.v1')::uuid,'version 2 names version 1');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'updateStoreProfile')),2::bigint,'queue filters the kind');
reset role;
select throws_ok($$update store_profile_versions set profile=profile||'{"concept":"x"}' where id=current_setting('test.v1')::uuid$$,'55000',null,'versions are immutable');
select * from finish();
rollback;
