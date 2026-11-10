begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f4690000-0000-4000-8000-000000000001','central-host@example.test',now(),null,null),
 ('f4690000-0000-4000-8000-000000000002','central-other@example.test',now(),null,null),
 ('f4690000-0000-4000-8000-000000000003','central-billing@example.test',now(),null,null),
 ('f4690000-0000-4000-8000-000000000004',null,null,'46700004694',now());
insert into platform_hosts(user_id,kind) values
 ('f4690000-0000-4000-8000-000000000001','person'),
 ('f4690000-0000-4000-8000-000000000003','billing');
insert into auth.sessions(id,user_id) values ('f4690000-0000-4000-8000-000000000091','f4690000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims='{"sub":"f4690000-0000-4000-8000-000000000002","role":"authenticated"}';
select create_tenant('Other owner','central-other-owner',gen_random_uuid()) as other \gset
set local request.jwt.claims='{"sub":"f4690000-0000-4000-8000-000000000001","session_id":"f4690000-0000-4000-8000-000000000091","role":"authenticated"}';
select create_tenant('Central owner','central-owner',gen_random_uuid()) as tenant \gset
select host_central_app_intake()->>'revision' as revision \gset
select throws_ok(format($$select set_central_app_intake(gen_random_uuid(),%L,%L)$$,:'revision',:'other'),'42501','FORBIDDEN','host designation cannot substitute for store owner/admin membership');
select gen_random_uuid() as command \gset
select set_central_app_intake(:'command',:'revision',:'tenant');
select start_host_support('f4690000-0000-4000-8000-000000000021',:'other','Synthetic support check');
select throws_ok(format($$select set_central_app_intake(gen_random_uuid(),%L,null)$$,:'command'),'42501','SUPPORT_READ_ONLY','support cannot pause central intake');
select throws_ok(format($$select set_central_app_intake(%L,%L,%L)$$,:'command',:'revision',:'tenant'),'42501','SUPPORT_READ_ONLY','support cannot replay configuration writes');
select end_host_support('f4690000-0000-4000-8000-000000000021');
set local request.jwt.claims='{"sub":"f4690000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select host_central_app_intake()$$,'42501','FORBIDDEN','billing service is not a person host');
select throws_ok(format($$select set_central_app_intake(gen_random_uuid(),%L,null)$$,:'command'),'42501','FORBIDDEN','billing service cannot configure central intake');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'f4690000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f4690000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_ok($$select host_central_app_intake()$$,'42501','FORBIDDEN','MFA gates settings reads');
select throws_ok(format($$select set_central_app_intake(gen_random_uuid(),%L,null)$$,:'command'),'42501','FORBIDDEN','MFA gates settings writes');
set local request.jwt.claims='{"sub":"f4690000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select lives_ok(format($$select set_central_app_intake(gen_random_uuid(),%L,null)$$,:'command'),'assured host can pause');
reset role;
select is((select count(*) from access_events where tenant_id=:'tenant' and action='central_app.recipient_changed'),2::bigint,'designation and pause retain audit events against the recipient tenant');
-- Historical row predates the residence declaration; do not manufacture consent.
insert into external_item_requests(id,owner_id,tenant_id,description,brand,condition,notes,currency,photos)
 values('f4690000-0000-4000-8000-000000000201','f4690000-0000-4000-8000-000000000004',:'tenant','Legacy','','good','','SEK',array['f4690000-0000-4000-8000-000000000101']::uuid[]);
set local role authenticated;
set local request.jwt.claims='{"sub":"f4690000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok(format($$select submit_external_item_request('f4690000-0000-4000-8000-000000000201',%L,'Legacy','','good','',null,'SEK',array['f4690000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'legacy exact retry survives central pause without residence declaration');
select throws_like(format($$select submit_external_item_request('f4690000-0000-4000-8000-000000000201',%L,'Legacy','','good','',null,'SEK',array['f4690000-0000-4000-8000-000000000101']::uuid[],'SE')$$,:'tenant'),'%REQUEST_CONFLICT%','retry cannot add a declaration retroactively');
select is(my_external_item_requests()#>'{requests,0,sender_country}','null'::jsonb,'legacy read retains absence of declaration');
select is(my_external_item_requests()#>>'{requests,0,store_name}','Central owner','legacy request keeps its actual store name');
select is((select count(*) from tenant_members),0::bigint,'central routing creates no seller membership');
select * from finish();
rollback;
