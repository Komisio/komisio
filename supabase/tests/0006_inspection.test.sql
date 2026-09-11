begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('70000000-0000-0000-0000-000000000001','owner@inspection.test',now()),
 ('70000000-0000-0000-0000-000000000002','staff@inspection.test',now()),
 ('70000000-0000-0000-0000-000000000003','reader@inspection.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.a',create_tenant('Inspection A','inspection-a',gen_random_uuid())::text,true);
select set_config('test.b',create_tenant('Inspection B','inspection-b',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller','','123')::text,true);
select set_config('test.bag',receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Test')::text,true);
select set_config('test.bag2',receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Other')::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
select lives_ok($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','','Tear')$$,'save initial descriptive draft');
select is((select revision from inspection_current),1,'first persisted revision is one');
select lives_ok($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','','Tear')$$,'identical retry succeeds');
select is((select count(*) from inspection_draft_revisions),1::bigint,'retry does not duplicate');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Changed','','Tear')$$,'%REQUEST_CONFLICT%','request binds content');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Stale','','')$$,'%INSPECTION_DRAFT_CHANGED%','stale revision rejected');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag2')::uuid,current_setting('test.draft')::uuid,1,'Moved','','')$$,'%INSPECTION_CONTEXT_CHANGED%','cannot move draft to another bag');
select throws_like($$select save_inspection_draft(current_setting('test.b')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,gen_random_uuid(),0,'Cross tenant','','')$$,'%BAG_NOT_FOUND%','cannot attach other tenant bag');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,gen_random_uuid(),0,' ','','')$$,'%INVALID_INPUT%','description required');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,gen_random_uuid(),0,repeat('x',1001),'','')$$,'%INVALID_INPUT%','description bounded');
select throws_ok($$update inspection_draft_revisions set description='Overwrite'$$,'42501',null,'direct update denied');
select throws_ok($$delete from inspection_draft_revisions$$,'42501',null,'direct delete denied');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.a')::uuid,'70000000-0000-0000-0000-000000000002','staff'),
 (current_setting('test.a')::uuid,'70000000-0000-0000-0000-000000000003','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,'Blue jacket','Clothes','Tear')$$,'another staff member resumes shared draft');
select is((select revision from inspection_current),2,'current view returns only latest revision');
select is((select description from inspection_draft_revisions where revision=1),'Jacket','old revision remains intact');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','','Tear')$$,'%REQUEST_CONFLICT%','retry cannot impersonate original actor');
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from inspection_current),1::bigint,'readonly reads current view');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,'Denied','','')$$,'%FORBIDDEN%','readonly cannot save');
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.request')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','','Tear')$$,'original retry succeeds after newer revision');
select is((select count(*) from inspection_draft_revisions),2::bigint,'late retry leaves history intact');
reset role;
delete from tenant_members where user_id='70000000-0000-0000-0000-000000000002';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from inspection_current),0::bigint,'view honors revoked membership');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,'Denied','','')$$,'%FORBIDDEN%','removed staff cannot save');
set local role anon;
select throws_ok($$select * from inspection_current$$,'42501',null,'anonymous view denied');
select throws_ok($$select save_inspection_draft(null,null,null,null,0,'','','')$$,'42501',null,'anonymous RPC denied');
reset role;
select throws_like($$update inspection_draft_revisions set description='Bypass'$$,'%IMMUTABLE_INSPECTION_REVISION%','immutable outside application grants');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'70000000-0000-0000-0000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from inspection_current),0::bigint,'MFA enforced on current view');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,'Denied','','')$$,'%AUTH_REQUIRED%','MFA enforced on save');
reset role;
select * from finish();
rollback;
