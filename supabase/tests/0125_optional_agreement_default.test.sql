begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000925','optional-agreement@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000925","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Optional agreement','optional-agreement-test',gen_random_uuid())::text,true);
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->'agreementRequiredFor','[]'::jsonb,'fresh store does not require an agreement');
reset role;
select is(komisio_private.current_store_policy_core(current_setting('test.tenant')::uuid)->'policy'->'agreementRequiredFor','[]'::jsonb,'automation uses the same optional fallback');
set local role authenticated;
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','optional-seller@example.test','')::text,true);
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select lives_ok($$select quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Unsigned lamp"}',25000)$$,'description and price can be received without any agreement');
select is((select count(*)::int from seller_agreement_evidence where tenant_id=current_setting('test.tenant')::uuid),0,'no signature evidence is fabricated');
select set_config('test.policy',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"agreementRequiredFor":["review_publication","acceptance"]}'::jsonb)::text,true);
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->'agreementRequiredFor','["review_publication","acceptance"]'::jsonb,'published opt-in overrides the default');
select set_config('test.session2',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Another lamp"}',25000)$$,'%AGREEMENT_REQUIRED%','explicit requirements still block unsigned reception');
reset role;
select is(komisio_private.current_store_policy_core(current_setting('test.tenant')::uuid)->'policy'->'agreementRequiredFor','["review_publication","acceptance"]'::jsonb,'automation respects the published requirement');
select * from finish();
rollback;

