begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('a5940000-0000-4000-8000-000000000001','activity-owner@example.test',now()),
 ('a5940000-0000-4000-8000-000000000002','activity-member@example.test',now()),
 ('a5940000-0000-4000-8000-000000000003','activity-former@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a5940000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.t',create_tenant('Activity','activity-test',gen_random_uuid())::text,true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.t')::uuid,'a5940000-0000-4000-8000-000000000002','admin');
insert into user_profiles(user_id,display_name) values
 ('a5940000-0000-4000-8000-000000000002','Current administrator'),
 ('a5940000-0000-4000-8000-000000000003','PRIVATE FORMER NAME');
insert into access_events(tenant_id,actor_id,action,occurred_at,detail)
 select current_setting('test.t')::uuid,'a5940000-0000-4000-8000-000000000002','tenant.renamed','2025-10-22T22:30:00Z','{"secret":"PRIVATE DETAIL"}' from generate_series(1,30);
insert into access_events(tenant_id,actor_id,action,occurred_at)
 values(current_setting('test.t')::uuid,'a5940000-0000-4000-8000-000000000003','tenant.renamed','2025-10-22T22:30:00Z');
set local role authenticated;
select set_config('test.result',store_activity(current_setting('test.t')::uuid,'2025-10-23','2025-10-23')::text,true);
select is((current_setting('test.result')::jsonb->>'total')::int,31,'inclusive Stockholm calendar day');
select is(jsonb_array_length(current_setting('test.result')::jsonb->'rows'),25,'bounded default page');
select is(current_setting('test.result')::jsonb->'rows'->0->>'actor_state','former','former member identified');
select is(current_setting('test.result')::jsonb->'rows'->0->>'actor_name',null,'former profile not exposed');
select is(current_setting('test.result')::jsonb->'rows'->1->>'actor_name','Current administrator','current member name');
select ok(current_setting('test.result') not like '%PRIVATE%', 'no detail or former profile in response');
select is((store_activity(current_setting('test.t')::uuid,'2025-10-22','2025-10-22')->>'total')::int,0,'previous Stockholm day excluded');
select is((store_activity(current_setting('test.t')::uuid,null,null,'a5940000-0000-4000-8000-000000000003')->>'total')::int,1,'actor filter');
select is((store_activity(current_setting('test.t')::uuid,null,null,null,'missing.action')->>'total')::int,0,'action filter');
select is(jsonb_array_length(store_activity(current_setting('test.t')::uuid,'2025-10-23','2025-10-23',null,null,25)->'rows'),6,'next page');
select is((select count(distinct r->>'id') from (
 select jsonb_array_elements(store_activity(current_setting('test.t')::uuid,'2025-10-23','2025-10-23')->'rows') r
 union all select jsonb_array_elements(store_activity(current_setting('test.t')::uuid,'2025-10-23','2025-10-23',null,null,25)->'rows')) s),31::bigint,'tied timestamps do not repeat across pages');
select ok((current_setting('test.result')::jsonb->'rows'->0->>'id')::bigint > (current_setting('test.result')::jsonb->'rows'->1->>'id')::bigint,'id tie breaker descending');
select throws_ok($$select store_activity(current_setting('test.t')::uuid,null,null,null,null,-1)$$,'INVALID_INPUT','negative offset');
select throws_ok($$select store_activity(current_setting('test.t')::uuid,null,null,null,null,1000001)$$,'INVALID_INPUT','large offset');
select throws_ok($$select store_activity(current_setting('test.t')::uuid,null,null,null,null,0,101)$$,'INVALID_INPUT','large limit');
select throws_ok($$select store_activity(current_setting('test.t')::uuid,null,null,null,null,0,0)$$,'INVALID_INPUT','zero limit');
select throws_ok($$select store_activity(current_setting('test.t')::uuid,'2025-10-24','2025-10-23')$$,'INVALID_INPUT','reversed dates');
select throws_ok($$select store_activity(gen_random_uuid())$$,'42501','FORBIDDEN','other tenant refused');
set local "request.jwt.claims"='{"sub":"a5940000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$select store_activity(current_setting('test.t')::uuid)$$,'admin reads');
reset role;
update tenant_members set role='staff' where user_id='a5940000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select store_activity(current_setting('test.t')::uuid)$$,'42501','FORBIDDEN','staff refused');
select is((select count(*) from access_events where tenant_id=current_setting('test.t')::uuid),0::bigint,'RLS still hides events from staff');
reset role;
update tenant_members set role='readonly' where user_id='a5940000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select store_activity(current_setting('test.t')::uuid)$$,'42501','FORBIDDEN','readonly refused');
set local "request.jwt.claims"='{"sub":"a5940000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select store_activity(current_setting('test.t')::uuid)$$,'42501','FORBIDDEN','former member refused');
set local role anon;
select throws_ok($$select store_activity(current_setting('test.t')::uuid)$$,'42501',null,'anonymous execute denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'a5940000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a5940000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_ok($$select store_activity(current_setting('test.t')::uuid)$$,'42501','AUTH_REQUIRED','MFA required before audit reads');
set local "request.jwt.claims"='{"sub":"a5940000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select lives_ok($$select store_activity(current_setting('test.t')::uuid)$$,'MFA verified owner reads');
select * from finish();
rollback;

