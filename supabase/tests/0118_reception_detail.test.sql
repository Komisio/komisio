begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000981','reception-detail-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000982','reception-detail-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000981","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Reception detail','reception-detail-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','','123')::text,true);
select set_config('test.session',gen_random_uuid()::text,true);
select set_config('test.empty',gen_random_uuid()::text,true);
select set_config('test.sources','[{"id":"f0000000-0000-4000-8000-000000000985","kind":"observation","reference":"TEST staff note","observation":"Blue jacket, visible tear"}]',true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.empty')::uuid,current_setting('test.seller')::uuid);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb);

-- The fields the application parses, from one call instead of two table reads.
select is(reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->>'session_id',current_setting('test.session'),'the session is returned');
select is(reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->>'seller_id',current_setting('test.seller'),'with the seller it belongs to');
select is((reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->>'revision')::int,1,'and the current revision');
select is(jsonb_array_length(reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->'sources'),1,'and the sources of that revision');
select is(reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->'sources'->0->>'observation','Blue jacket, visible tear','the observation is carried through unchanged');
-- A second revision wins, which is how the web sees a reception being worked on.
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.sources')::jsonb||'[{"id":"f0000000-0000-4000-8000-000000000986","kind":"observation","reference":"TEST staff note","observation":"Also a scarf"}]'::jsonb);
select is((reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->>'revision')::int,2,'a later revision replaces the earlier one');
select is(jsonb_array_length(reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)->'sources'),2,'and its sources are the ones returned');
-- A reception that has been started but carries nothing yet is not an error.
select is((reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.empty')::uuid)->>'revision')::int,0,'a session without sources is revision zero');
select is(reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.empty')::uuid)->'sources','null'::jsonb,'and carries no sources');
select is(reception_session_detail(current_setting('test.tenant')::uuid,gen_random_uuid()),null,'an unknown session is null, not an error');

-- The read belongs to a member of that store.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000982","role":"authenticated"}';
select throws_ok($$select reception_session_detail(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid)$$,'42501',null,'an outsider cannot read a reception');

-- Each of the three tools reaches the read under its own scope, and the
-- staged review has a proposal kind under the propose scope.
reset role;
select is((select count(*) from connector_functions where function_name='reception_session_detail'),3::bigint,'the read is registered for three scopes');
select is((select count(*) from connector_functions where function_name='reception_session_detail' and scope in('reception:read','reception:preview','reception:propose')),3::bigint,'and they are the scopes the tools ask for');
select is((select kind from connector_functions where function_name='propose_operation' and scope='reception:propose'),'publishReceptionReview','the reception proposal kind is registered');
select * from finish();
rollback;
