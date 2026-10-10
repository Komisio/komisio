begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000002951','queue-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000002952','queue-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000002953','queue-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002951","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Queue store','queue-store',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic Sally','queue-seller@example.test','')::text,true);
select set_config('test.path',current_setting('test.tenant')||'/'||current_setting('test.seller')||'/'||gen_random_uuid()::text||'.jpg',true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002952","role":"authenticated"}';
insert into storage.objects(bucket_id,name) values('seller-submission-photos',current_setting('test.path'));
do $$ begin
 for n in 1..31 loop
  perform submit_my_assisted_items(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,'Synthetic jacket '||n,jsonb_build_array(current_setting('test.path')),null,null,'store','SEK');
 end loop;
end $$;
select throws_like($$select submission_queue(current_setting('test.tenant')::uuid,'all','',0)$$,'%FORBIDDEN%','seller cannot read staff queue');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002951","role":"authenticated"}';
select set_config('test.invited',(select id::text from seller_submissions where tenant_id=current_setting('test.tenant')::uuid and description='Synthetic jacket 1'),true);
select review_seller_submission(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.invited')::uuid,'invite','Welcome',false);
select set_config('test.prepared',prepare_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.invited')::uuid)::text,true);
select set_config('test.declined',(select id::text from seller_submissions where tenant_id=current_setting('test.tenant')::uuid and description='Synthetic jacket 2'),true);
select review_seller_submission(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.declined')::uuid,'decline','Not this time',false);
select is(submission_queue(current_setting('test.tenant')::uuid,'all','',0)->>'total','31','all matching rows counted before paging');
select is(jsonb_array_length(submission_queue(current_setting('test.tenant')::uuid,'all','',0)->'rows'),25,'first page bounded');
select is(jsonb_array_length(submission_queue(current_setting('test.tenant')::uuid,'all','',25)->'rows'),6,'next page reachable');
select is(submission_queue(current_setting('test.tenant')::uuid,'pending','',0)->>'total','29','pending excludes answered proposals');
select is(submission_queue(current_setting('test.tenant')::uuid,'invited','',0)->>'total','1','prepared draft still awaits registration');
select is(submission_queue(current_setting('test.tenant')::uuid,'registered','',0)->>'total','0','preparation is not registered inventory');
select is(submission_queue(current_setting('test.tenant')::uuid,'all','sAlLy',0)->>'total','31','case-insensitive seller name search');
select is(submission_queue(current_setting('test.tenant')::uuid,'pending','jacket 31',0)->>'total','1','description search across whole queue');
select is(submission_queue(current_setting('test.tenant')::uuid,'all','%',0)->>'total','0','search treats wildcard as literal text');
select is(submission_queue(current_setting('test.tenant')::uuid,'all','',100)->>'total','31','empty high page retains count for redirect');
select is(jsonb_array_length(submission_queue(current_setting('test.tenant')::uuid,'all','',100)->'rows'),0,'high page empty without range error');
select throws_like($$select submission_queue(current_setting('test.tenant')::uuid,'invalid','',0)$$,'%INVALID_INPUT%','invalid filter refused');
select throws_like($$select submission_queue(current_setting('test.tenant')::uuid,'all','',-1)$$,'%INVALID_INPUT%','negative page refused');
select throws_like($$select submission_queue(current_setting('test.tenant')::uuid,'all',repeat('a',101),0)$$,'%INVALID_INPUT%','search length bounded');
reset role;
-- Historical read fixture: acceptance presence, not an alternate acceptance command.
insert into public.items(id,tenant_id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_by)
 values('f0000000-0000-4000-8000-000000002959',current_setting('test.tenant')::uuid,'reception_review',current_setting('test.prepared')::uuid,1,'garment',gen_random_uuid(),current_setting('test.seller')::uuid,'consignment','{}','f0000000-0000-4000-8000-000000002951');
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002953','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002953","role":"authenticated"}';
select is(submission_queue(current_setting('test.tenant')::uuid,'invited','',0)->>'total','0','registered item leaves invitations');
select is(submission_queue(current_setting('test.tenant')::uuid,'registered','',0)->'rows'->0->>'item_id','f0000000-0000-4000-8000-000000002959','readonly sees exact accepted item');
select throws_like($$select submission_queue(gen_random_uuid(),'all','',0)$$,'%FORBIDDEN%','other tenant denied');
reset role;
select ok(not has_function_privilege('anon','public.submission_queue(uuid,text,text,integer)','execute'),'anonymous denied');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000002951','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002951","role":"authenticated","aal":"aal1"}';
select throws_like($$select submission_queue(current_setting('test.tenant')::uuid,'all','',0)$$,'%AUTH_REQUIRED%','MFA enforced');
reset role;
select * from finish(); rollback;
