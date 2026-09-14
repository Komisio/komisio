begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000710','image-reader-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000711','image-reader-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000710","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Image readers','image-readers',gen_random_uuid())::text,true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000711','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000711","role":"authenticated"}';
select lives_ok($$select zettle_image_status(current_setting('test.tenant')::uuid)$$,'staff may read status');
select lives_ok($$select zettle_image_status_v2(current_setting('test.tenant')::uuid)$$,'staff may use versioned read');
select is(zettle_item_image_url(current_setting('test.tenant')::uuid,gen_random_uuid()),null::text,'staff URL read returns no unrelated item');
select throws_ok($$select zettle_image_status_v2(gen_random_uuid())$$,'42501',null,'other tenant denied');
select throws_ok($$select record_zettle_image_upload(current_setting('test.tenant')::uuid,gen_random_uuid(),'https://image.izettle.com/product/synthetic.jpg')$$,'42501',null,'staff cannot write');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000711','totp','verified',now(),now());
set local role authenticated;
select throws_ok($$select zettle_image_status_v2(current_setting('test.tenant')::uuid)$$,'42501',null,'staff MFA remains required');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000711","role":"authenticated","aal":"aal2"}';
select lives_ok($$select zettle_image_status_v2(current_setting('test.tenant')::uuid)$$,'verified staff can read');
select * from finish();
rollback;
