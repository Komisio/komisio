begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('80000000-0000-4000-8000-000000000001','owner@reception.test',now()),
 ('80000000-0000-4000-8000-000000000002','staff@reception.test',now()),
 ('80000000-0000-4000-8000-000000000003','reader@reception.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.a',create_tenant('Reception A','reception-a',gen_random_uuid())::text,true);
select set_config('test.b',create_tenant('Reception B','reception-b',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller','','123')::text,true);
select set_config('test.session',gen_random_uuid()::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
select set_config('test.sources','[{"id":"80000000-0000-4000-8000-000000000010","kind":"observation","reference":"TEST staff note","observation":"Blue jacket, visible tear"}]',true);
select lives_ok($$select create_reception_session(current_setting('test.a')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid)$$,'create session without fake bag');
select lives_ok($$select create_reception_session(current_setting('test.a')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid)$$,'create retry is stable');
select is((select count(*) from reception_sessions),1::bigint,'one session');
select throws_like($$select create_reception_session(current_setting('test.b')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)$$,'%SELLER_NOT_FOUND%','seller must belong to session store');
select lives_ok($$select save_reception_sources(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb)$$,'save source snapshot');
select is((select revision from reception_sources_current),1,'initial revision');
select lives_ok($$select save_reception_sources(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb)$$,'save retry succeeds');
select is((select count(*) from reception_source_revisions),1::bigint,'one source revision after retry');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb)$$,'%RECEPTION_CHANGED%','stale expected revision rejected');
select throws_like($$select save_reception_sources(current_setting('test.b')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.sources')::jsonb)$$,'%RECEPTION_NOT_FOUND%','cannot move session across stores');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'[]')$$,'%INVALID_INPUT%','empty source snapshot rejected');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,jsonb_set(jsonb_set(current_setting('test.sources')::jsonb,'{0,kind}','"photo"'),'{0,id}',to_jsonb(gen_random_uuid()::text)))$$,'%INVALID_INPUT%','unowned photo references cannot become evidence');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,jsonb_set(current_setting('test.sources')::jsonb,'{0,approved}','true'))$$,'%INVALID_INPUT%','source cannot smuggle authority');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.sources')::jsonb || current_setting('test.sources')::jsonb)$$,'%INVALID_INPUT%','duplicate source IDs rejected');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,jsonb_set(current_setting('test.sources')::jsonb,'{0,observation}','"Changed under same ID"'))$$,'%RECEPTION_SOURCE_CHANGED%','source identity preserves original content');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,0,jsonb_set(current_setting('test.sources')::jsonb,'{0,observation}','"Changed retry"'))$$,'%REQUEST_CONFLICT%','request binds content');
select throws_ok($$insert into reception_sessions(id,tenant_id,seller_id,created_by) values(gen_random_uuid(),current_setting('test.a')::uuid,current_setting('test.seller')::uuid,auth.uid())$$,'42501',null,'direct writes denied');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.a')::uuid,'80000000-0000-4000-8000-000000000002','staff'),
 (current_setting('test.a')::uuid,'80000000-0000-4000-8000-000000000003','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb)$$,'%REQUEST_CONFLICT%','retry binds original actor');
select lives_ok($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,jsonb_set(current_setting('test.sources')::jsonb,'{0,id}','"80000000-0000-4000-8000-000000000011"'))$$,'staff appends replacement source with new ID');
select is((select revision from reception_sources_current),2,'new current source revision');
set local "request.jwt.claims"='{"sub":"80000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from reception_source_revisions),2::bigint,'readonly reads history');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,2,current_setting('test.sources')::jsonb)$$,'%FORBIDDEN%','readonly cannot append');
set local "request.jwt.claims"='{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select save_reception_sources(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb)$$,'original retry remains stable after newer revisions');
select is((select revision from reception_sources_current),2,'old retry does not roll back current');
reset role;
select throws_like($$update reception_source_revisions set revision=9$$,'%IMMUTABLE_RECEPTION%','history immutable outside application grants');
select throws_like($$delete from reception_sessions$$,'%IMMUTABLE_RECEPTION%','session identity preserved');
delete from tenant_members where user_id='80000000-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from reception_sources_current),0::bigint,'revoked staff sees no sources');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,2,current_setting('test.sources')::jsonb)$$,'%FORBIDDEN%','revoked staff cannot write');
set local role anon;
select throws_ok($$select * from reception_sessions$$,'42501',null,'anonymous reads denied');
select throws_ok($$select create_reception_session(null,null,null)$$,'42501',null,'anonymous RPC denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'80000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from reception_sources_current),0::bigint,'MFA gates read');
select throws_like($$select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,2,current_setting('test.sources')::jsonb)$$,'%AUTH_REQUIRED%','MFA gates write');
select * from finish();
rollback;
