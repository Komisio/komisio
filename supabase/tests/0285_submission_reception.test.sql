begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000008001','submission-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000008002','submission-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000008003','submission-stranger@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Submissions test','submissions-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','submission-seller@example.test','')::text,true);
select set_config('test.id',gen_random_uuid()::text,true);
select set_config('test.path',current_setting('test.tenant')||'/'||current_setting('test.seller')||'/'||gen_random_uuid()::text||'.jpg',true);
select set_config('test.photos',jsonb_build_array(current_setting('test.path'))::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008002","role":"authenticated"}';
insert into storage.objects(bucket_id,name) values('seller-submission-photos',current_setting('test.path'));
select is(my_submission_settings(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'pricing','store','default store pricing');
select throws_like($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,current_setting('test.id')::uuid,current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,'100.00','store','SEK')$$,'%INVALID_INPUT%','seller cannot set price in store mode');
select lives_ok($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,current_setting('test.id')::uuid,current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,null,'store','SEK')$$,'ordinary submission preserved');
select is(my_item_submissions(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->0->>'pricing_mode','store','frozen mode visible');

set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008001","role":"authenticated"}';
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"submissionPricing":"seller"}');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008002","role":"authenticated"}';
select set_config('test.priced',gen_random_uuid()::text,true);
select throws_like($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,null,'store','SEK')$$,'%SUBMISSION_CHANGED%','stale pricing mode cannot submit');
select lives_ok($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,current_setting('test.priced')::uuid,current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,'125.50','seller','SEK')$$,'seller price submitted');
select lives_ok($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,current_setting('test.priced')::uuid,current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,'125.50','seller','SEK')$$,'price retry idempotent');
select throws_like($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,current_setting('test.priced')::uuid,current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,'126','seller','SEK')$$,'%REQUEST_CONFLICT%','cannot change saved seller price on retry');
select throws_like($$select submit_my_items(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb)$$,'%SUBMISSION_CHANGED%','legacy endpoint cannot bypass price mode');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008001","role":"authenticated"}';
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"submissionPricing":"approval"}');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008002","role":"authenticated"}';
select set_config('test.approval',gen_random_uuid()::text,true);
select lives_ok($$select submit_my_assisted_items(current_setting('test.tenant')::uuid,current_setting('test.approval')::uuid,current_setting('test.seller')::uuid,null,'Jacket',current_setting('test.photos')::jsonb,null,'150','approval','SEK')$$,'seller proposes price for approval');
select throws_like($$select review_seller_submission(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.approval')::uuid,'invite','',true)$$,'%FORBIDDEN%','seller cannot approve own price');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008001","role":"authenticated"}';
select throws_like($$select review_seller_submission(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.approval')::uuid,'invite','')$$,'%INVALID_INPUT%','invitation requires explicit price approval');
select lives_ok($$select review_seller_submission(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.approval')::uuid,'invite','',true)$$,'staff explicitly approves price');

select set_config('test.session',prepare_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.approval')::uuid)::text,true);
select is(prepare_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.approval')::uuid)::text,current_setting('test.session'),'repeat preparation returns same session');
select is((select count(*) from submission_receptions where submission_id=current_setting('test.approval')::uuid),1::bigint,'one preparation link');
select throws_like($$select prepare_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.priced')::uuid)$$,'%SUBMISSION_NOT_INVITED%','pending proposal cannot prepare');
select throws_like($$select complete_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.approval')::uuid,'Shirt','150.00')$$,'%PHOTO_NOT_FOUND%','photos must copy before draft completes');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008002","role":"authenticated"}';
select throws_ok($$select prepare_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.approval')::uuid)$$,'42501',null,'seller cannot record reception');
select is((select count(*) from submission_receptions),0::bigint,'seller cannot read staff preparation links');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008003","role":"authenticated"}';
select throws_ok($$select prepare_submission_reception(current_setting('test.tenant')::uuid,current_setting('test.approval')::uuid)$$,'42501',null,'outsider cannot prepare');
reset role;
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'preparation never accepts inventory');
select is((select count(*) from garment_receipts where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'preparation never claims custody');
select * from finish();
rollback;
