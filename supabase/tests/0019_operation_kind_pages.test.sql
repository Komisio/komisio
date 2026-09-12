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
-- More recent proposals of another kind must not consume the selected page.
insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at,created_at)
select gen_random_uuid(),current_setting('test.tenant')::uuid,'publishReceptionReview','low',
 jsonb_build_object('sessionId',gen_random_uuid(),'sourceRevision',1,'previousReviewId',null,'agreementId',gen_random_uuid(),'expiresAt',(now()+interval '1 day')::text,
 'suggestions','{"metadata":{"description":{"value":"Fixture","sourceIds":["e0000000-0000-4000-8000-000000000010"],"certainty":"observed"}},"price":{"currency":"SEK","amount":"100.00","rationale":"Fixture","sourceIds":["e0000000-0000-4000-8000-000000000011"]},"questions":[]}'::jsonb),
 'agent','private fixture label','e0000000-0000-4000-8000-000000000001',now()+interval '1 day',now()
from generate_series(1,60);
set local role authenticated;
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'saveInspectionDraft')),21::bigint,'kind filters before page limit despite60 newer other-kind proposals');
select is((select count(distinct kind) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'saveInspectionDraft')),1::bigint,'one inspection kind');
select is((select kind from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'publishReceptionReview') limit 1),'publishReceptionReview','reception kind');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'expired',null,null,'saveInspectionDraft')),1::bigint,'status combines with kind');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'expired',null,null,'publishReceptionReview')),0::bigint,'other kind cannot populate expired filter');
select is((select id from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'open','2026-09-01 12:00:00.123457+00','e1000000-0000-4000-8000-000000000006','saveInspectionDraft')),'e1000000-0000-4000-8000-000000000005'::uuid,'kind page preserves microsecond continuation');
select is((select count(*) from operation_queue_page(current_setting('test.tenant')::uuid,'all',null,null)),21::bigint,'four argument compatibility read');
select is((select count(*) from operation_queue(current_setting('test.tenant')::uuid)),50::bigint,'legacy compatibility read');
select throws_like($$select * from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'unknown')$$,'%INVALID_INPUT%','unknown kind denied');
select throws_like($$select * from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'bogus',null,null,'saveInspectionDraft')$$,'%INVALID_INPUT%','unknown status denied');
select throws_like($$select * from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',now(),null,'saveInspectionDraft')$$,'%INVALID_INPUT%','partial cursor denied');
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'saveInspectionDraft')),21::bigint,'readonly may discover');
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select * from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'saveInspectionDraft')$$,'42501',null,'outsider denied');
set local role anon;
select throws_ok($$select * from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'saveInspectionDraft')$$,'42501',null,'anonymous denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'e0000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select * from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'saveInspectionDraft')$$,'42501',null,'MFA denial on new read');
select * from finish();
rollback;
