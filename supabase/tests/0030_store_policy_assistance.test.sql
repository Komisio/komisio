begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000000121','assist-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000121","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Assistance policy test','assist-policy-test',gen_random_uuid())::text,true);
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
-- Assistance is on by default from 2026-09-16 (owner decision). This file is
-- about a store setting the flag explicitly, either way; the default itself
-- and what happens to already published policies are in 0121.
select is(current_setting('test.body')::jsonb->'assistanceEnabled','true'::jsonb,'the default enables assistance');
select set_config('test.id',gen_random_uuid()::text,true);
select lives_ok($$select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.id')::uuid,null,current_setting('test.body')::jsonb || '{"assistanceEnabled":true}')$$,'tenant enables assistance in its policy');
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->>'assistanceEnabled','true','enablement is read back');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.id')::uuid,current_setting('test.body')::jsonb || '{"assistanceEnabled":"yes"}')$$,'%INVALID_INPUT%','text flag rejected');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.id')::uuid,current_setting('test.body')::jsonb || '{"assistanceProvider":"openai"}')$$,'%INVALID_INPUT%','policy never selects a provider');
select lives_ok($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.id')::uuid,current_setting('test.body')::jsonb || '{"assistanceEnabled":false,"vatRatePercent":25}')$$,'flag coexists with VAT keys');
select * from finish();
rollback;
