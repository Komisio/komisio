begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('80000000-0000-0000-0000-000000000001','owner@archive.test',now()),
 ('80000000-0000-0000-0000-000000000002','staff@archive.test',now()),
 ('80000000-0000-0000-0000-000000000003','reader@archive.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.a',create_tenant('Archive A','archive-a',gen_random_uuid())::text,true);
select set_config('test.b',create_tenant('Archive B','archive-b',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller','','123')::text,true);
select set_config('test.bag',receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Test')::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select set_config('test.save',gen_random_uuid()::text,true);
select set_config('test.archive',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.save')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','Clothes','Tear');
select is((select archived from inspection_current),false,'existing save creates active draft');
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,true,' ')$$,'%INVALID_INPUT%','reason required');
select lives_ok($$select set_inspection_archived(current_setting('test.a')::uuid,current_setting('test.archive')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,true,'Duplicate draft')$$,'archive appends a revision');
select is((select archived from inspection_current),true,'current state archived');
select is((select description from inspection_current),'Jacket','description preserved');
select is((select change_reason from inspection_current),'Duplicate draft','reason retained');
select is((select archived from inspection_draft_revisions where revision=1),false,'previous version unchanged');
select lives_ok($$select set_inspection_archived(current_setting('test.a')::uuid,current_setting('test.archive')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,true,'Duplicate draft')$$,'same archive request replays');
select is((select count(*) from inspection_draft_revisions),2::bigint,'archive retry does not duplicate');
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,current_setting('test.archive')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,true,'Other reason')$$,'%REQUEST_CONFLICT%','request binds reason');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,'Edited','','')$$,'%INSPECTION_ARCHIVED%','archived draft cannot be edited');
select throws_like($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.archive')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,'Jacket','Clothes','Tear')$$,'%REQUEST_CONFLICT%','save cannot replay archive command');
select lives_ok($$select save_inspection_draft(current_setting('test.a')::uuid,current_setting('test.save')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','Clothes','Tear')$$,'original save retry succeeds after archive');
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,false,'Stale')$$,'%INSPECTION_DRAFT_CHANGED%','stale reopen fails');
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,true,'Again')$$,'%INSPECTION_STATUS_UNCHANGED%','new repeated archive is not a new event');
select throws_like($$select set_inspection_archived(current_setting('test.b')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,false,'Cross store')$$,'%INSPECTION_NOT_FOUND%','cross-store status change denied');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.a')::uuid,'80000000-0000-0000-0000-000000000002','staff'),
 (current_setting('test.a')::uuid,'80000000-0000-0000-0000-000000000003','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,false,'Reopened for inspection')$$,'staff can reopen');
select is((select archived from inspection_current),false,'reopened draft active');
select lives_ok($$select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,3,'Blue jacket','Clothes','Tear')$$,'reopened draft editable');
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,current_setting('test.archive')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,true,'Duplicate draft')$$,'%REQUEST_CONFLICT%','request remains bound to original actor');
set local "request.jwt.claims"='{"sub":"80000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,4,true,'Reader')$$,'%FORBIDDEN%','readonly cannot archive');
select is((select count(*) from inspection_draft_revisions),4::bigint,'readonly can inspect history');
set local "request.jwt.claims"='{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select set_inspection_archived(current_setting('test.a')::uuid,current_setting('test.archive')::uuid,current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,1,true,'Duplicate draft')$$,'archive replay after reopen resolves original');
select is((select archived from inspection_current),false,'old archive replay does not archive again');
reset role;
delete from tenant_members where user_id='80000000-0000-0000-0000-000000000002';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,4,true,'Removed')$$,'%FORBIDDEN%','removed member denied');
set local role anon;
select throws_ok($$select set_inspection_archived(null,null,null,null,1,true,'')$$,'42501',null,'anonymous denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'80000000-0000-0000-0000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_like($$select set_inspection_archived(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,4,true,'MFA')$$,'%AUTH_REQUIRED%','MFA enforced');
reset role;
select * from finish();
rollback;
