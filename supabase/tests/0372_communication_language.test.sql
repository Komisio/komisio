begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000006111','mail-language-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000006112','mail-language-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000006113','mail-language-other@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000006111","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Mail language fixture','mail-language-fixture',gen_random_uuid())::text,true);
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select is(current_store_profile(current_setting('test.tenant')::uuid)->'profile','null'::jsonb,'store has no published profile');
select set_config('test.first',gen_random_uuid()::text,true);
select lives_ok($$select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.first')::uuid,null,current_setting('test.body')::jsonb || '{"communicationLanguage":"dk"}')$$,'owner saves a mail language without publishing a profile');
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->>'communicationLanguage','dk','store mail default is read back');
select is(current_store_profile(current_setting('test.tenant')::uuid)->'profile','null'::jsonb,'setting mail language does not publish public store details');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"xx"}')$$,'%INVALID_INPUT%','unknown locale rejected');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":null}')$$,'%INVALID_INPUT%','null locale rejected');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":3}')$$,'%INVALID_INPUT%','non-text locale rejected');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"fi","commissionRatePercent":101}')$$,'%INVALID_INPUT%','existing financial validation remains enforced');
select set_config('test.second',gen_random_uuid()::text,true);
select lives_ok($$select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.second')::uuid,current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"fi"}')$$,'language change is a new policy version');
select is(publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.second')::uuid,current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"fi"}'),current_setting('test.second')::uuid,'same request replays safely');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.second')::uuid,current_setting('test.first')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"en"}')$$,'%REQUEST_CONFLICT%','replay cannot silently change language');
select is((select policy->>'communicationLanguage' from store_policy_versions where id=current_setting('test.first')::uuid),'dk','prior policy language is immutable');
reset role;
insert into public.tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000006112','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000006112","role":"authenticated"}';
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->>'communicationLanguage','fi','staff may read the store default');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.second')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"en"}')$$,'%FORBIDDEN%','staff cannot publish a different default');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000006113","role":"authenticated"}';
select throws_like($$select current_store_policy(current_setting('test.tenant')::uuid)$$,'%FORBIDDEN%','nonmember cannot read policy language');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.second')::uuid,current_setting('test.body')::jsonb || '{"communicationLanguage":"en"}')$$,'%FORBIDDEN%','nonmember cannot change policy language');
reset role;
select ok(komisio_private.valid_store_policy(current_setting('test.body')::jsonb || jsonb_build_object('communicationLanguage',lang)),lang || ' accepted') from unnest(array['sv','en','no','dk','fi','de','es','it']) lang;
select ok(komisio_private.valid_store_policy(current_setting('test.body')::jsonb),'existing policies remain valid without mail language');
select * from finish();
rollback;
