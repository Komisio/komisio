begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f2220000-0000-4000-8000-000000000001','initial-currency@example.test',now()),
 ('f2220000-0000-4000-8000-000000000002','initial-other@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2220000-0000-4000-8000-000000000001","role":"authenticated"}';
create temporary table initial_currency_cases as
select locale,currency,create_tenant_with_locale('Initial store','initial-'||locale,gen_random_uuid(),locale) as tenant
 from (values ('sv','SEK'),('no','NOK'),('dk','DKK'),('en','EUR'),('fi','EUR'),('de','EUR'),('es','EUR'),('it','EUR')) as cases(locale,currency);
select is(store_currency(tenant),currency,'initial currency for '||locale) from initial_currency_cases;
select set_config('test.legacy',create_tenant('Legacy store','initial-legacy',gen_random_uuid())::text,true);
select is(store_currency(current_setting('test.legacy')::uuid),'SEK','legacy creation retains SEK');
select set_config('test.request',gen_random_uuid()::text,true);
select set_config('test.tenant',create_tenant_with_locale('Norwegian store','initial-norwegian',current_setting('test.request')::uuid,'no')::text,true);
select is(create_tenant_with_locale('Norwegian store','initial-norwegian',current_setting('test.request')::uuid,'sv'),current_setting('test.tenant')::uuid,'retry after language change returns the same tenant');
select is(store_currency(current_setting('test.tenant')::uuid),'NOK','retry never changes the currency');
select is((select count(*) from store_policy_versions where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'retry publishes no duplicate policy');
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->>'currency','NOK','policy and money readers agree');
select is(economy_summary(current_setting('test.tenant')::uuid,current_date,current_date)->>'currency','NOK','empty overview reports NOK');
select save_profile('Norwegian owner','sv');
select is(store_currency(current_setting('test.tenant')::uuid),'NOK','profile language does not change currency');
select throws_like($$select create_tenant_with_locale('Invalid','initial-invalid',gen_random_uuid(),'xx')$$,'%INVALID_INPUT%','unsupported locale rejected');
select throws_like($$select create_tenant_with_locale('Invalid','initial-invalid',gen_random_uuid(),null)$$,'%INVALID_INPUT%','null locale rejected');
select is((select count(*) from tenants where slug='initial-invalid'),0::bigint,'invalid input leaves no tenant');
select throws_ok($$update tenants set name='hijack' where id=current_setting('test.tenant')::uuid$$,'42501',null,'direct tenant updates remain denied');
select throws_ok($$update store_policy_versions set policy=policy || '{"currency":"SEK"}' where tenant_id=current_setting('test.tenant')::uuid$$,'42501',null,'direct policy updates remain denied');
select set_config('test.policy',(current_store_policy(current_setting('test.tenant')::uuid)->>'id'),true);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',10000,'Synthetic currency test',true)::text,true);
select is((select currency from purchase_receipts where id=current_setting('test.purchase')::uuid),'NOK','money fact uses initialized currency');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"currency":"SEK"}')$$,'%CURRENCY_FROZEN%','first money fact still freezes currency');
select create_tenant_with_locale('Norwegian store','initial-norwegian',current_setting('test.request')::uuid,'dk');
select is(store_currency(current_setting('test.tenant')::uuid),'NOK','creation retry cannot reset frozen currency');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f2220000-0000-4000-8000-000000000002','owner');
set local role authenticated;
select change_member(current_setting('test.tenant')::uuid,'f2220000-0000-4000-8000-000000000001',null);
select throws_like($$select create_tenant_with_locale('Norwegian store','initial-norwegian',current_setting('test.request')::uuid,'no')$$,'%FORBIDDEN%','removed creator cannot regain access through retry');
set local role anon;
select throws_ok($$select create_tenant_with_locale('Anonymous','initial-anon',gen_random_uuid(),'no')$$,'42501',null,'anonymous creation remains denied');
reset role;
select * from finish();
rollback;
