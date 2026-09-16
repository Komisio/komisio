begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000911','assist-default-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000911","role":"authenticated"}';
select set_config('test.fresh',create_tenant('Fresh assist','assist-default-fresh',gen_random_uuid())::text,true);
select set_config('test.published',create_tenant('Published assist','assist-default-published',gen_random_uuid())::text,true);

-- A store that has published nothing meets a reception screen with assistance
-- available, because the fallback policy now says so.
select is(current_store_policy(current_setting('test.fresh')::uuid)->'policy'->'assistanceEnabled','true'::jsonb,'a new store has assistance on');
select is((current_store_policy(current_setting('test.fresh')::uuid)->>'version')::int,0,'without having published anything');
-- Nothing else about the default moved with it.
select is(current_store_policy(current_setting('test.fresh')::uuid)->'policy'->>'commissionRatePercent','60','the commission default is untouched');
select is(current_store_policy(current_setting('test.fresh')::uuid)->'policy'->>'sellerReviewMode','delegated','and so is the review mode');

-- A store that published a policy without the key keeps what it published:
-- assistance stays off until its owner publishes again with the box ticked.
select set_config('test.body',(current_store_policy(current_setting('test.published')::uuid)->'policy')::text,true);
select publish_store_policy(current_setting('test.published')::uuid,gen_random_uuid(),null,(current_setting('test.body')::jsonb - 'assistanceEnabled'));
select ok(not (current_store_policy(current_setting('test.published')::uuid)->'policy' ? 'assistanceEnabled'),'a published policy without the key keeps it absent');
select is(current_store_policy(current_setting('test.published')::uuid)->'policy'->'assistanceEnabled',null,'so assistance is not switched on behind the store''s back');

-- And an owner may publish it off, which is the whole point of a default.
-- Each publication names the policy it replaces.
select publish_store_policy(current_setting('test.published')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.published')::uuid)->>'id')::uuid,current_setting('test.body')::jsonb || '{"assistanceEnabled":false}');
select is(current_store_policy(current_setting('test.published')::uuid)->'policy'->'assistanceEnabled','false'::jsonb,'an owner can turn it off');
select publish_store_policy(current_setting('test.published')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.published')::uuid)->>'id')::uuid,current_setting('test.body')::jsonb || '{"assistanceEnabled":true}');
select is(current_store_policy(current_setting('test.published')::uuid)->'policy'->'assistanceEnabled','true'::jsonb,'and on again');
select * from finish();
rollback;
