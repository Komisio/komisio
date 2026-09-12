begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('e0000000-0000-4000-8000-000000000001','owner@queue-pages.test',now()),
 ('e0000000-0000-4000-8000-000000000002','reader@queue-pages.test',now()),
 ('e0000000-0000-4000-8000-000000000003','outsider@queue-pages.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Queue pages','queue-pages',gen_random_uuid())::text,true);
select set_config('test.empty',create_tenant('Empty queue','queue-empty',gen_random_uuid())::text,true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'e0000000-0000-4000-8000-000000000002','readonly');
-- Synthetic history fixtures exercise reads, not the proposal command's preflight.
insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at,created_at)
select ('e1000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,current_setting('test.tenant')::uuid,'saveInspectionDraft','low',
 jsonb_build_object('bagId',gen_random_uuid(),'draftId',gen_random_uuid(),'expectedRevision',1,'fields',jsonb_build_object('description','Fixture '||g,'category','','condition','')),
 'agent','page-fixture','e0000000-0000-4000-8000-000000000001',case when g=1 then now()-interval '1 hour' else now()+interval '1 day' end,
 '2026-09-01 12:00:00.123456+00'::timestamptz+(g/5)*interval '1 microsecond'
from generate_series(1,55) g;
insert into operation_decisions(id,tenant_id,operation_id,decision,outcome,result_id,error_code,reason,decided_by)
select gen_random_uuid(),current_setting('test.tenant')::uuid,('e1000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 case when g=2 then 'rejected' else 'approved' end,
 case when g=2 then 'rejected' when g=3 then 'failed' else 'executed' end,
 case when g=4 then gen_random_uuid() end,case when g=3 then 'INSPECTION_DRAFT_CHANGED' else '' end,'fixture','e0000000-0000-4000-8000-000000000001'
from generate_series(2,4) g;
set local role authenticated;
select is((select count(*) from operation_queue(current_setting('test.tenant')::uuid)),50::bigint,'legacy RPC remains newest 50');
select is((select count(*) from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null)),21::bigint,'new RPC bounds rows plus one probe');
create temporary table page_one as select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null) limit 20;
select set_config('test.before_time',(select created_at::text from page_one order by created_at,id limit 1),true);
select set_config('test.before_id',(select id::text from page_one order by created_at,id limit 1),true);
select is(current_setting('test.before_id'),'e1000000-0000-4000-8000-000000000036','first page retains newest 20 in deterministic order');
create temporary table page_two as select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',current_setting('test.before_time')::timestamptz,current_setting('test.before_id')::uuid) limit 20;
select is((select id from page_two order by created_at desc,id desc limit 1),'e1000000-0000-4000-8000-000000000035'::uuid,'equal-time UUID tie continues without a gap');
select set_config('test.before_time',(select created_at::text from page_two order by created_at,id limit 1),true);
select set_config('test.before_id',(select id::text from page_two order by created_at,id limit 1),true);
create temporary table page_three as select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',current_setting('test.before_time')::timestamptz,current_setting('test.before_id')::uuid);
select is((select count(*) from page_three),15::bigint,'last page includes rows beyond legacy window');
select is((select count(distinct id) from(select id from page_one union all select id from page_two union all select id from page_three) x),55::bigint,'all pages have exactly 55 distinct proposals');
select is((select count(*) from operation_queue_page(current_setting('test.empty')::uuid,'all',null,null)),0::bigint,'authorized empty queue');
select is((select id from operation_queue_page(current_setting('test.tenant')::uuid,'open','2026-09-01 12:00:00.123457+00','e1000000-0000-4000-8000-000000000006')),'e1000000-0000-4000-8000-000000000005'::uuid,'old open proposal is reachable despite microsecond cursor and closed rows');
select is((select id from operation_queue_page(current_setting('test.tenant')::uuid,'expired',null,null)),'e1000000-0000-4000-8000-000000000001'::uuid,'expired filter');
select is((select id from operation_queue_page(current_setting('test.tenant')::uuid,'rejected',null,null)),'e1000000-0000-4000-8000-000000000002'::uuid,'rejected filter');
select is((select id from operation_queue_page(current_setting('test.tenant')::uuid,'failed',null,null)),'e1000000-0000-4000-8000-000000000003'::uuid,'failed filter');
select is((select id from operation_queue_page(current_setting('test.tenant')::uuid,'executed',null,null)),'e1000000-0000-4000-8000-000000000004'::uuid,'executed filter');
select throws_like($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'bogus',null,null)$$,'%INVALID_INPUT%','unknown status rejected');
select throws_like($$select * from operation_queue_page(current_setting('test.tenant')::uuid,null,null,null)$$,'%INVALID_INPUT%','null status rejected');
select throws_like($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',now(),null)$$,'%INVALID_INPUT%','timestamp alone rejected');
select throws_like($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,gen_random_uuid())$$,'%INVALID_INPUT%','UUID alone rejected');
select throws_like($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'all','infinity',gen_random_uuid())$$,'%INVALID_INPUT%','infinite timestamp rejected');
select is((select count(*) from pending_operations),55::bigint,'read creates no proposal');
select is((select count(*) from operation_decisions),3::bigint,'read creates no decision');
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null)),21::bigint,'readonly may page');
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null)$$,'42501',null,'outsider denied');
set local role anon;
select throws_ok($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null)$$,'42501',null,'anonymous denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'e0000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select * from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null)$$,'42501',null,'MFA is required on each page');
select * from finish();
rollback;
