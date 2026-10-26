begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f3640000-0000-4000-8000-000000000001','agreement-owner@example.test',now()),
 ('f3640000-0000-4000-8000-000000000002','agreement-seller@example.test',now()),
 ('f3640000-0000-4000-8000-000000000003','agreement-other@example.test',now()),
 ('f3640000-0000-4000-8000-000000000004','agreement-company@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f3640000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Agreement summary','agreement-summary',gen_random_uuid()) as tenant \gset
select create_tenant('Other summary','other-summary',gen_random_uuid()) as other_tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Correct saved seller','agreement-seller@example.test','') as seller \gset
select register_seller(:'tenant',gen_random_uuid(),'Other seller','agreement-other@example.test','') as other_seller \gset
select gen_random_uuid() as company \gset
select register_seller_with_profile(:'tenant',:'company','{"name":"Synthetic company","email":"agreement-company@example.test","phone":"","addressLine1":"","addressLine2":"","postalCode":"","city":"","country":"","language":"en","notes":"PRIVATE","sellerType":"business"}');
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"commissionRatePercent":35,"commissionBasis":"inclusive","salePeriodDays":42,"endOfPeriodAction":"return"}');
set local "request.jwt.claims"='{"sub":"f3640000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_seller_terms_summary(:'tenant',:'seller')->>'sellerName','Correct saved seller','summary identifies the linked seller, not the signed-in staff');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'commissionRatePercent','35','rate uses saved store policy');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'commissionBasis','inclusive','private default follows policy basis');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'salePeriodDays','42','day period is saved setting');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'endOfPeriodAction','return','end action is the saved setting');
select ok(not (my_seller_terms_summary(:'tenant',:'seller') ? 'notes'),'summary excludes internal terms notes');
select throws_ok(format('select my_seller_terms_summary(%L,%L)',:'tenant',:'other_seller'),'42501',null,'another seller stays inaccessible');
select throws_ok(format('select my_seller_terms_summary(%L,%L)',:'other_tenant',:'seller'),'42501',null,'cross-store identity stays inaccessible');
set local "request.jwt.claims"='{"sub":"f3640000-0000-4000-8000-000000000001","role":"authenticated"}';
select publish_seller_terms(:'tenant',gen_random_uuid(),:'seller',null,'exclusive',12.5,'PRIVATE terms note');
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,(current_store_policy(:'tenant')->'policy') || '{"consignmentPeriod":{"months":2,"collectionDays":14},"endOfPeriodAction":"charity"}');
set local "request.jwt.claims"='{"sub":"f3640000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((my_seller_terms_summary(:'tenant',:'seller')->>'commissionRatePercent')::numeric,12.5::numeric,'seller-specific rate wins');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'commissionBasis','exclusive','seller-specific basis wins');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'months','2','calendar period is distinguished from day period');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'collectionDays','14','collection grace is reported');
select is(my_seller_terms_summary(:'tenant',:'seller')->>'endOfPeriodAction','return','calendar periods use the existing collection workflow');
select ok(my_seller_terms_summary(:'tenant',:'seller')::text not like '%PRIVATE%','private notes never cross the seller boundary');
set local "request.jwt.claims"='{"sub":"f3640000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(my_seller_terms_summary(:'tenant',:'company')->>'commissionBasis','exclusive','business commission uses the existing exclusive default');
reset role;
select ok(not has_function_privilege('anon','public.my_seller_terms_summary(uuid,uuid)','EXECUTE'),'anonymous users cannot read summaries');
select * from finish();
rollback;
