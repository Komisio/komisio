begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('77700000-0000-0000-0000-000000000001','support-host@example.test',now()),
 ('77700000-0000-0000-0000-000000000002','support-owner@example.test',now()),
 ('77700000-0000-0000-0000-000000000003','support-outsider@example.test',now()),
 ('77700000-0000-0000-0000-000000000004','support-billing@example.test',now());
insert into platform_hosts(user_id,kind) values
 ('77700000-0000-0000-0000-000000000001','person'),
 ('77700000-0000-0000-0000-000000000004','billing');
insert into auth.sessions(id,user_id) values
 ('77700000-0000-0000-0000-000000000091','77700000-0000-0000-0000-000000000001'),
 ('77700000-0000-0000-0000-000000000092','77700000-0000-0000-0000-000000000001');
insert into tenants(id,slug,name,created_by) values
 ('77700000-0000-0000-0000-000000000011','support-one','Support one','77700000-0000-0000-0000-000000000002'),
 ('77700000-0000-0000-0000-000000000012','support-two','Support two','77700000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000003","session_id":"77700000-0000-0000-0000-000000000099","role":"authenticated"}';
select throws_ok($$select start_host_support('77700000-0000-0000-0000-000000000021','77700000-0000-0000-0000-000000000011','Investigate')$$,'42501','FORBIDDEN','ordinary users cannot start support');
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000004","session_id":"77700000-0000-0000-0000-000000000099","role":"authenticated"}';
select throws_ok($$select start_host_support('77700000-0000-0000-0000-000000000021','77700000-0000-0000-0000-000000000011','Investigate')$$,'42501','FORBIDDEN','billing actors cannot start support');
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select start_host_support('77700000-0000-0000-0000-000000000021','77700000-0000-0000-0000-000000000011','Investigate')$$,'42501','AUTH_REQUIRED','support requires an authenticated session id');
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated"}';
select is(tenant_role('77700000-0000-0000-0000-000000000011'),null::text,'host has no implicit store role');
select throws_ok($$select start_host_support('77700000-0000-0000-0000-000000000021','77700000-0000-0000-0000-000000000011',' ')$$,'P0001','INVALID_INPUT','a reason is required');
select lives_ok($$select start_host_support('77700000-0000-0000-0000-000000000021','77700000-0000-0000-0000-000000000011','Investigate seller registration')$$,'host opens support');
select is(tenant_role('77700000-0000-0000-0000-000000000011'),'readonly','support grants only readonly');
select is(tenant_role('77700000-0000-0000-0000-000000000012'),null::text,'existing owner rights are suspended in this session');
select is((select count(*) from tenants),1::bigint,'only the support store is visible');
select is((select count(*) from tenant_members where user_id=auth.uid()),0::bigint,'support creates no membership');
select lives_ok($$select start_host_support('77700000-0000-0000-0000-000000000021','77700000-0000-0000-0000-000000000011','Investigate seller registration')$$,'lost response retries reuse the same visit');
select throws_ok($$select start_host_support('77700000-0000-0000-0000-000000000022','77700000-0000-0000-0000-000000000012','Other')$$,'P0001','SUPPORT_ACTIVE','a second start cannot replace the visit');
select throws_ok($$select rename_tenant('77700000-0000-0000-0000-000000000011','Changed')$$,'42501','FORBIDDEN','write RPC is denied');
select throws_ok($$select create_tenant('No store','support-new','77700000-0000-0000-0000-000000000030')$$,'42501','SUPPORT_READ_ONLY','membership-independent creation is also denied');
select throws_ok($$select set_active_tenant('77700000-0000-0000-0000-000000000012')$$,'42501','SUPPORT_READ_ONLY','old store picker cannot escape support');
select throws_ok($$select save_profile('Changed','sv')$$,'42501','SUPPORT_READ_ONLY','public writes are denied at the table boundary');
select throws_ok($$select end_host_support('77700000-0000-0000-0000-000000000022')$$,'42501','FORBIDDEN','wrong visit cannot be ended');
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000092","role":"authenticated"}';
select is(tenant_role('77700000-0000-0000-0000-000000000011'),null::text,'support does not transfer to another login');
select is(tenant_role('77700000-0000-0000-0000-000000000012'),'owner','another login retains ordinary membership');
select throws_ok($$select end_host_support('77700000-0000-0000-0000-000000000021')$$,'42501','FORBIDDEN','another login cannot end the visit');
reset role;
set local request.jwt.claims='{}';
select is((select count(*) from komisio_private.host_support_visits where user_id='77700000-0000-0000-0000-000000000001'),1::bigint,'one immutable start record');
select is((select expires_at-started_at from komisio_private.host_support_visits where id='77700000-0000-0000-0000-000000000021'),interval '60 minutes','fixed server-side duration');
select throws_ok($$update komisio_private.host_support_visits set reason='Changed' where id='77700000-0000-0000-0000-000000000021'$$,'55000','IMMUTABLE','audit start cannot be edited');
delete from platform_hosts where user_id='77700000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated"}';
select is(tenant_role('77700000-0000-0000-0000-000000000011'),null::text,'revoked host immediately loses support reads');
select is((host_support_context()->>'available')::boolean,false,'revocation is exposed as unavailable');
select throws_ok($$select save_profile('Changed','sv')$$,'42501','SUPPORT_READ_ONLY','revocation does not restore old write rights');
select lives_ok($$select end_host_support('77700000-0000-0000-0000-000000000021')$$,'revoked host can still exit their own visit');
select lives_ok($$select end_host_support('77700000-0000-0000-0000-000000000021')$$,'exit is idempotent');
select is(tenant_role('77700000-0000-0000-0000-000000000012'),'owner','exit restores actual membership');
reset role;
set local request.jwt.claims='{}';
select is((select count(*) from komisio_private.host_support_ends where ended_by='77700000-0000-0000-0000-000000000001'),1::bigint,'one immutable end record');
select throws_ok($$delete from komisio_private.host_support_ends where visit_id='77700000-0000-0000-0000-000000000021'$$,'55000','IMMUTABLE','audit end cannot be deleted');
-- A trusted fixture may create an already expired visit, never update audit rows.
insert into platform_hosts(user_id,kind) values ('77700000-0000-0000-0000-000000000001','person');
insert into komisio_private.host_support_visits(id,user_id,auth_session_id,tenant_id,reason,started_at,expires_at)
 values('77700000-0000-0000-0000-000000000023','77700000-0000-0000-0000-000000000001','77700000-0000-0000-0000-000000000091','77700000-0000-0000-0000-000000000012','Expired fixture',now()-interval '61 minutes',now()-interval '1 minute');
set local role authenticated;
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated"}';
select is(tenant_role('77700000-0000-0000-0000-000000000012'),null::text,'expiry never restores owner access silently');
select is((select count(*) from tenants),0::bigint,'expired visits reveal no store data');
select throws_ok($$select save_profile('Changed','sv')$$,'42501','SUPPORT_READ_ONLY','expiry remains fail closed for writes');
select lives_ok($$select end_host_support('77700000-0000-0000-0000-000000000023')$$,'expired visit can be explicitly ended');
reset role;
set local request.jwt.claims='{}';
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'77700000-0000-0000-0000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated","aal":"aal1"}';
select throws_ok($$select start_host_support('77700000-0000-0000-0000-000000000024','77700000-0000-0000-0000-000000000012','Own store')$$,'42501','AUTH_REQUIRED','enrolled MFA must be satisfied');
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated","aal":"aal2"}';
select lives_ok($$select start_host_support('77700000-0000-0000-0000-000000000024','77700000-0000-0000-0000-000000000012','Own store')$$,'verified MFA permits a visit');
select is(tenant_role('77700000-0000-0000-0000-000000000012'),'readonly','support in own store also downgrades owner rights');
select throws_ok($$select rename_tenant('77700000-0000-0000-0000-000000000012','Changed')$$,'42501','FORBIDDEN','own store write RPC is denied');
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated","aal":"aal1"}';
select is(tenant_role('77700000-0000-0000-0000-000000000012'),null::text,'lost assurance revokes current reads');
reset role;
set local request.jwt.claims='{}';
delete from auth.sessions where id='77700000-0000-0000-0000-000000000091';
set local role authenticated;
set local request.jwt.claims='{"sub":"77700000-0000-0000-0000-000000000001","session_id":"77700000-0000-0000-0000-000000000091","role":"authenticated","aal":"aal2"}';
select is(tenant_role('77700000-0000-0000-0000-000000000012'),null::text,'revoked Auth session cannot retain support access');
select is((host_support_context()->>'available')::boolean,false,'revoked Auth session fails closed');
reset role;
set local request.jwt.claims='{}';
select ok(not has_function_privilege('anon','public.start_host_support(uuid,uuid,text)','execute'),'anonymous start is not granted');
select ok(not has_function_privilege('authenticated','komisio_private.support_session_verified()','execute'),'private helper is not exposed');
-- Every business table must keep this guard, including future migrations.
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and (n.nspname in ('public','komisio_private') or (n.nspname='storage' and c.relname='objects'))
 and c.relname not in ('host_support_visits','host_support_ends','spatial_ref_sys')
 and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
 and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='support_read_only_guard' and t.tgenabled='O')),
 0::bigint,'all business tables enforce the support write boundary');
select * from finish();
rollback;
