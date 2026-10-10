begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('29900000-0000-4000-8000-000000000001','owner@photo-history.test',now()),
 ('29900000-0000-4000-8000-000000000002','seller@photo-history.test',now()),
 ('29900000-0000-4000-8000-000000000003','other@photo-history.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"29900000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('History TEST','history-test',gen_random_uuid())::text,true);
select set_config('test.foreign',create_tenant('Foreign TEST','history-foreign-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller TEST','seller@photo-history.test','')::text,true);
select set_config('test.other',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Other TEST','other@photo-history.test','')::text,true);
select set_config('test.foreign_seller',register_seller(current_setting('test.foreign')::uuid,gen_random_uuid(),'Foreign TEST','seller@photo-history.test','')::text,true);
-- Synthetic historical fixtures deliberately share timestamps to exercise stable ties.
reset role;
insert into seller_submissions(id,tenant_id,seller_id,description,photos,created_by,created_at)
 select ('29900000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'History '||i,'["synthetic.jpg"]','29900000-0000-4000-8000-000000000002','2026-01-01' from generate_series(1,53) i;
insert into seller_submissions(id,tenant_id,seller_id,description,photos,created_by,previous_id,created_at) values
 ('29900000-0000-4000-8002-000000000001',current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'Already corrected','["synthetic.jpg"]','29900000-0000-4000-8000-000000000002','29900000-0000-4000-8001-000000000001','2026-02-01'),
 ('29900000-0000-4000-8003-000000000001',current_setting('test.tenant')::uuid,current_setting('test.other')::uuid,'OTHER PRIVATE','["synthetic.jpg"]','29900000-0000-4000-8000-000000000003',null,'2026-02-01'),
 ('29900000-0000-4000-8004-000000000001',current_setting('test.foreign')::uuid,current_setting('test.foreign_seller')::uuid,'FOREIGN PRIVATE','["synthetic.jpg"]','29900000-0000-4000-8000-000000000002',null,'2026-02-01');
insert into seller_submission_reviews(id,tenant_id,submission_id,decision,note,created_by)
 select gen_random_uuid(),current_setting('test.tenant')::uuid,('29900000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,'more_information','Show label','29900000-0000-4000-8000-000000000001' from generate_series(1,2) i;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"29900000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.first',my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,0,null)::text,true);
select set_config('test.last',my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,50,'29900000-0000-4000-8001-000000000001')::text,true);
select is((current_setting('test.first')::jsonb->>'total')::int,54,'own exact count only');
select is(jsonb_array_length(current_setting('test.first')::jsonb->'rows'),25,'bounded first page');
select is(jsonb_array_length(current_setting('test.last')::jsonb->'rows'),4,'older than original fifty limit reachable');
select is(current_setting('test.first')::jsonb->'rows'->0->>'description','Already corrected','stable latest-first order');
select is(current_setting('test.last')::jsonb->'rows'->3->>'description','History 1','UUID tie ordering deterministic');
select is(current_setting('test.last')::jsonb->'selected'->>'id','29900000-0000-4000-8001-000000000001','exact selected old row');
select is((current_setting('test.last')::jsonb->'selected'->>'has_correction')::boolean,true,'correction outside visible page detected');
select is((my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,0,'29900000-0000-4000-8001-000000000002')->'selected'->>'has_correction')::boolean,false,'unanswered older correction reachable independently');
select is(my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,0,'29900000-0000-4000-8003-000000000001')->'selected','null'::jsonb,'other seller selected row excluded');
select is(my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,0,'29900000-0000-4000-8004-000000000001')->'selected','null'::jsonb,'other tenant selected row excluded');
select is(my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,0,'29900000-0000-4000-8001-000000000003')->'selected','null'::jsonb,'unreviewed row not a correction target');
select is(jsonb_array_length(my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,2500000,null)->'rows'),0,'out-of-range page bounded');
select ok(not current_setting('test.first') like '%PRIVATE%','no foreign data in totals or rows');
select ok(not (current_setting('test.last')::jsonb->'selected' ? 'created_by'),'internal actor not projected');
select throws_like($$select my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,-1,null)$$,'%INVALID_INPUT%','negative offset refused');
select throws_like($$select my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,null,null)$$,'%INVALID_INPUT%','null offset refused');
select throws_ok($$select my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.other')::uuid,0,null)$$,'42501',null,'another seller identity refused');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'29900000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"29900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select throws_ok($$select my_submission_history(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,0,null)$$,'42501',null,'MFA still required');
reset role;
select ok(not has_function_privilege('anon','public.my_submission_history(uuid,uuid,integer,uuid)','execute'),'anonymous denied');
select * from finish();
rollback;
