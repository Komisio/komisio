begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f6100000-0000-4000-8000-000000000001','external-staff@example.test',now(),null,null),
 ('f6100000-0000-4000-8000-000000000002',null,null,'46700006102',now()),
 ('f6100000-0000-4000-8000-000000000003',null,null,'46700006103',null),
 ('f6100000-0000-4000-8000-000000000004',null,null,'46700006104',now()),
 ('f6100000-0000-4000-8000-000000000005','external-readonly@example.test',now(),null,null),
 ('f6100000-0000-4000-8000-000000000006','external-other-staff@example.test',now(),null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic request store','synthetic-request-store',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic other requests','synthetic-other-requests',gen_random_uuid()) as other \gset
select current_store_policy(:'tenant')->'policy' as body \gset
select gen_random_uuid() as enabled \gset
select publish_store_policy(:'tenant',:'enabled',null,:'body'::jsonb || '{"externalAppSubmissionsEnabled":true}');
select publish_store_policy(:'other',gen_random_uuid(),null,:'body'::jsonb || '{"externalAppSubmissionsEnabled":true}');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (:'tenant','f6100000-0000-4000-8000-000000000005','readonly'),
 (:'other','f6100000-0000-4000-8000-000000000006','staff');
create function pg_temp.submit_request(i uuid,t uuid,p uuid[],price numeric default 10000,c text default 'SEK') returns uuid language sql as $$
 select public.submit_external_item_request(i,t,'Jacket','Synthetic','good','',price,c,p);
$$;
set local role authenticated;
select throws_like($$select reserve_external_item_photo(gen_random_uuid(),repeat('a',64),100)$$,'%PHONE_VERIFICATION_REQUIRED%','email verification is not phone verification');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000003","role":"authenticated","phone_confirmed_at":"2026-01-01"}';
select throws_like($$select reserve_external_item_photo(gen_random_uuid(),repeat('a',64),100)$$,'%PHONE_VERIFICATION_REQUIRED%','unverified Auth phone cannot be spoofed in claims');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.verified_session(),false,'phone access does not relax existing email access');
select is((select count(*) from tenant_members),0::bigint,'phone identity has no membership');
select is(reserve_external_item_photo('f6100000-0000-4000-8000-000000000101',repeat('a',64),100),
 'f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000101.jpg','photo path binds the real user');
select lives_ok($$select reserve_external_item_photo('f6100000-0000-4000-8000-000000000101',repeat('a',64),100)$$,'photo reservation replays');
select throws_like($$select reserve_external_item_photo('f6100000-0000-4000-8000-000000000101',repeat('b',64),100)$$,'%REQUEST_CONFLICT%','different photo bytes cannot reuse a key');
select throws_like($$select reserve_external_item_photo(gen_random_uuid(),repeat('a',64),1048577)$$,'%INVALID_INPUT%','photo bound is server-enforced');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'%PHOTO_NOT_FOUND%','reservation without uploaded object cannot submit');
insert into storage.objects(bucket_id,name) values ('external-item-photos','f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000101.jpg');
select throws_ok($$insert into storage.objects(bucket_id,name) values('external-item-photos','f6100000-0000-4000-8000-000000000002/unreserved.jpg')$$,'42501',null,'unreserved uploads denied');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[],1.5)$$,:'tenant'),'%INVALID_INPUT%','fractional ore rejected');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[],0)$$,:'tenant'),'%INVALID_INPUT%','zero price wish rejected');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[],100,'EUR')$$,:'tenant'),'%STORE_CHANGED%','store currency is checked at submission');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101','f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'%INVALID_INPUT%','duplicate photos rejected');
select is(pg_temp.submit_request('f6100000-0000-4000-8000-000000000201',:'tenant',array['f6100000-0000-4000-8000-000000000101']::uuid[]),
 'f6100000-0000-4000-8000-000000000201'::uuid,'phone-only user submits without becoming a seller');
select lives_ok(format($$select pg_temp.submit_request('f6100000-0000-4000-8000-000000000201',%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'lost-response replay succeeds');
select throws_like(format($$select pg_temp.submit_request('f6100000-0000-4000-8000-000000000201',%L,array['f6100000-0000-4000-8000-000000000101']::uuid[],200)$$,:'tenant'),'%REQUEST_CONFLICT%','changed replay rejected');
select is((select count(*) from external_item_requests),1::bigint,'one request after replay');
select is((select count(*) from sellers),0::bigint,'no seller access is granted');
select throws_like($$select discard_external_item_photo('f6100000-0000-4000-8000-000000000101')$$,'%PHOTO_IN_USE%','submitted evidence cannot be discarded');
select is(public.external_item_photo_access('f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000101.jpg','delete'),false,'direct Storage delete of submitted photo denied');
select throws_ok($$update external_item_requests set description='Changed'$$,'42501',null,'direct request changes denied');
select throws_ok($$delete from external_item_requests$$,'42501',null,'direct request deletion denied');
select pg_temp.submit_request(gen_random_uuid(),:'other',array['f6100000-0000-4000-8000-000000000101']::uuid[]) from generate_series(1,9);
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'%ACTIVE_REQUEST_LIMIT%','ten-active cap spans stores');
select lives_ok(format($$select pg_temp.submit_request('f6100000-0000-4000-8000-000000000201',%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'exact replay is allowed at the cap');
select is(my_external_item_requests()->>'activeCount','10','server count is exact');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*) from external_item_requests),1::bigint,'readonly staff see only the selected recipient store');
select throws_ok(format($$select decline_external_item_request(gen_random_uuid(),%L,'f6100000-0000-4000-8000-000000000201','')$$,:'tenant'),'42501','FORBIDDEN','readonly staff cannot decline');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*) from external_item_requests where tenant_id=:'tenant'),0::bigint,'another store cannot read the selected store requests');
select throws_ok(format($$select decline_external_item_request(gen_random_uuid(),%L,'f6100000-0000-4000-8000-000000000201','')$$,:'tenant'),'42501','FORBIDDEN','another store cannot review a request');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*) from external_item_requests),0::bigint,'another phone identity cannot read requests');
select is((select count(*) from external_item_photos),0::bigint,'another phone identity cannot read photos');
select is(public.external_item_photo_access('f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000101.jpg','read'),false,'another phone identity cannot download photos');
select throws_like($$select reserve_external_item_photo('f6100000-0000-4000-8000-000000000101',repeat('a',64),100)$$,'%REQUEST_CONFLICT%','another owner cannot steal reservation');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'%PHOTO_NOT_FOUND%','another owner cannot attach photos');
select throws_ok(format($$select decline_external_item_request(gen_random_uuid(),%L,'f6100000-0000-4000-8000-000000000201','')$$,:'tenant'),'42501',null,'phone owner cannot impersonate staff');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from external_item_requests where tenant_id=:'tenant'),1::bigint,'recipient staff can read their queue');
select is(public.external_item_photo_access('f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000101.jpg','read'),true,'recipient staff can read submitted photos');
select gen_random_uuid() as decline \gset
select lives_ok(format($$select decline_external_item_request(%L,%L,'f6100000-0000-4000-8000-000000000201','Not our assortment')$$,:'decline',:'tenant'),'staff can decline with optional explanation');
select lives_ok(format($$select decline_external_item_request(%L,%L,'f6100000-0000-4000-8000-000000000201','Not our assortment')$$,:'decline',:'tenant'),'decline replays once');
select throws_like(format($$select decline_external_item_request(gen_random_uuid(),%L,'f6100000-0000-4000-8000-000000000201','')$$,:'tenant'),'%REQUEST_CHANGED%','a second decline cannot overwrite history');
select publish_store_policy(:'tenant',gen_random_uuid(),:'enabled',:'body'::jsonb || '{"externalAppSubmissionsEnabled":false}');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_external_item_requests()->>'activeCount','9','decline frees exactly one slot');
select throws_like(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'%STORE_UNAVAILABLE%','opt-out is authoritative');
select lives_ok(format($$select pg_temp.submit_request('f6100000-0000-4000-8000-000000000201',%L,array['f6100000-0000-4000-8000-000000000101']::uuid[])$$,:'tenant'),'replay survives opt-out and decline');
select lives_ok(format($$select pg_temp.submit_request(gen_random_uuid(),%L,array['f6100000-0000-4000-8000-000000000101']::uuid[],null)$$,:'other'),'freed slot accepts a new request without a price wish');
select reserve_external_item_photo('f6100000-0000-4000-8000-000000000102',repeat('b',64),100);
insert into storage.objects(bucket_id,name) values ('external-item-photos','f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000102.jpg');
select discard_external_item_photo('f6100000-0000-4000-8000-000000000102');
select throws_like($$select finish_external_item_photo_discard('f6100000-0000-4000-8000-000000000102')$$,'%PHOTO_STILL_STORED%','quota cannot be freed while object remains');
-- Reproduce the Storage service transaction; the actor still uses authenticated RLS.
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='external-item-photos' and name='f6100000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000102.jpg';
select lives_ok($$select finish_external_item_photo_discard('f6100000-0000-4000-8000-000000000102')$$,'confirmed discard releases reservation');
select is(discard_external_item_photo('f6100000-0000-4000-8000-000000000102'),null::text,'completed discard retries do not invent another file to remove');
select reserve_external_item_photo(gen_random_uuid(),repeat('c',64),100) from generate_series(1,80);
select throws_like($$select reserve_external_item_photo(gen_random_uuid(),repeat('d',64),100)$$,'%PHOTO_LIMIT%','unsubmitted photo quota is bounded');
reset role;
select is((select count(*) from tenant_members where user_id='f6100000-0000-4000-8000-000000000002'),0::bigint,'submission created no membership');
select is((select count(*) from sellers where tenant_id in (:'tenant',:'other')),0::bigint,'submission created no seller record');
select is((select count(*) from external_item_request_declines),1::bigint,'declines are immutable facts');
select throws_like($$update external_item_requests set description='Changed'$$,'%IMMUTABLE%','request evidence is protected even for privileged SQL');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'f6100000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select is((select count(*) from external_item_requests),0::bigint,'MFA assurance gates direct reads');
select throws_like($$select my_external_item_requests()$$,'%PHONE_VERIFICATION_REQUIRED%','MFA assurance gates RPC reads');
set local request.jwt.claims='{"sub":"f6100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is(my_external_item_requests()->>'activeCount','10','verified MFA restores only phone-scoped access');
reset role;
update auth.users set raw_app_meta_data='{"komisio_password_recovery_pending":true}' where id='f6100000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from external_item_requests),0::bigint,'protected recovery metadata gates direct request reads');
select throws_like($$select my_external_item_requests()$$,'%PHONE_VERIFICATION_REQUIRED%','protected recovery metadata also gates RPCs');
set local role anon;
select throws_ok($$select my_external_item_requests()$$,'42501',null,'anonymous requests are denied');
select throws_ok($$select * from external_item_requests$$,'42501',null,'anonymous reads are denied');
select * from finish();
rollback;

