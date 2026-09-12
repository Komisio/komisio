begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000031','terms-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000032','terms-reader@example.test',now()),
 ('f0000000-0000-4000-8000-000000000033','terms-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000034','terms-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000031","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Terms test','terms-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other terms','terms-other',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@terms.test','')::text,true);
select set_config('test.foreign',register_seller(current_setting('test.other')::uuid,gen_random_uuid(),'Other seller','other@terms.test','')::text,true);
select set_config('test.eff',effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.eff')::jsonb->>'version')::int,0,'no seller version yet');
select is(current_setting('test.eff')::jsonb->>'commissionBasis','inclusive','basis comes from policy');
select is((current_setting('test.eff')::jsonb->>'commissionRatePercent')::numeric,60::numeric,'rate comes from policy');
select is(current_setting('test.eff')::jsonb->'overrides','{"commissionBasis":false,"commissionRatePercent":false}'::jsonb,'nothing overridden');
select set_config('test.id',gen_random_uuid()::text,true);
select is(publish_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.id')::uuid,current_setting('test.seller')::uuid,null,null,50,'Long-time seller'),current_setting('test.id')::uuid,'owner publishes a rate override');
select is(publish_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.id')::uuid,current_setting('test.seller')::uuid,null,null,50,'Long-time seller'),current_setting('test.id')::uuid,'exact retry returns the same version');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.id')::uuid,current_setting('test.seller')::uuid,null,null,55,'Long-time seller')$$,'%REQUEST_CONFLICT%','changed retry rejected');
select set_config('test.eff',effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.eff')::jsonb->>'version')::int,1,'version one');
select is((current_setting('test.eff')::jsonb->>'commissionRatePercent')::numeric,50::numeric,'seller rate overrides policy');
select is(current_setting('test.eff')::jsonb->>'commissionBasis','inclusive','basis still from policy');
select is(current_setting('test.eff')::jsonb->'overrides'->>'commissionRatePercent','true','rate marked as override');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,null,40,'')$$,'%SELLER_TERMS_CHANGED%','stale expected version rejected');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.id')::uuid,'gross',null,'')$$,'%INVALID_INPUT%','unknown basis rejected');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.id')::uuid,null,50.005,'')$$,'%INVALID_INPUT%','fractional percent beyond two decimals rejected');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.id')::uuid,null,100.01,'')$$,'%INVALID_INPUT%','rate above 100 rejected');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid(),null,null,50,'')$$,'%SELLER_NOT_FOUND%','unknown seller rejected');
select throws_like($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.foreign')::uuid,null,null,50,'')$$,'%SELLER_NOT_FOUND%','another tenant seller rejected');
select throws_like($$select effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.foreign')::uuid)$$,'%SELLER_NOT_FOUND%','cross-tenant read rejected');
select throws_ok($$update seller_terms_versions set notes='x'$$,'42501',null,'direct update denied');
select throws_ok($$delete from seller_terms_versions$$,'42501',null,'direct delete denied');
-- Policy change flows through when the seller has no override for that field.
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select set_config('test.policy',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"commissionBasis":"exclusive","commissionRatePercent":40}')::text,true);
select set_config('test.eff',effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is(current_setting('test.eff')::jsonb->>'commissionBasis','exclusive','new policy basis applies');
select is((current_setting('test.eff')::jsonb->>'commissionRatePercent')::numeric,50::numeric,'seller override survives policy change');
select is(current_setting('test.eff')::jsonb->>'storePolicyId',current_setting('test.policy'),'effective terms name the policy version used');
-- Removing the override is a new version with null, never an edit.
select set_config('test.id2',gen_random_uuid()::text,true);
select is(publish_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.id2')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,'inclusive',null,'Back to policy rate'),current_setting('test.id2')::uuid,'second version published');
select set_config('test.eff',effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.eff')::jsonb->>'version')::int,2,'version two');
select is((current_setting('test.eff')::jsonb->>'commissionRatePercent')::numeric,40::numeric,'rate back to policy');
select is(current_setting('test.eff')::jsonb->>'commissionBasis','inclusive','basis now overridden');
select is((select count(*) from seller_terms_versions where seller_id=current_setting('test.seller')::uuid),2::bigint,'history kept');
reset role;
select throws_like($$update seller_terms_versions set notes='x' where tenant_id=current_setting('test.tenant')::uuid$$,'%IMMUTABLE_SELLER_TERMS%','privileged updates immutable');
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000032','readonly'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000033','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000032","role":"authenticated"}';
select is((effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'version')::int,2,'readonly reads effective terms');
select throws_ok($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.id2')::uuid,null,30,'')$$,'42501',null,'readonly cannot publish');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000033","role":"authenticated"}';
select lives_ok($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.id2')::uuid,null,30,'Staff adjusted')$$,'staff may publish seller terms');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000034","role":"authenticated"}';
select throws_ok($$select effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'outsider cannot read');
select is((select count(*) from seller_terms_versions),0::bigint,'RLS hides other tenants');
set local role anon;
select throws_ok($$select effective_seller_terms(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'anonymous denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000031','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000031","role":"authenticated","aal":"aal1"}';
select throws_ok($$select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,null,30,'')$$,'42501',null,'MFA write enforced');
select * from finish();
rollback;
