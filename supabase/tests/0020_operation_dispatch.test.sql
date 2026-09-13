begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Per-kind functions exist, are private, and the dispatchers reject unknown kinds.
select ok(not has_function_privilege('authenticated','komisio_private.operation_risk(text)','execute'),'risk function is private');
select ok(not has_function_privilege('authenticated','komisio_private.op_preflight_publish_reception_review(uuid,jsonb)','execute'),'reception preflight is private');
select ok(not has_function_privilege('authenticated','komisio_private.op_execute_publish_reception_review(uuid,uuid,jsonb)','execute'),'reception execute is private');
select ok(not has_function_privilege('authenticated','komisio_private.op_preflight_save_inspection_draft(uuid,jsonb)','execute'),'inspection preflight is private');
select ok(not has_function_privilege('authenticated','komisio_private.op_execute_save_inspection_draft(uuid,uuid,jsonb)','execute'),'inspection execute is private');
select is(komisio_private.operation_risk('publishReceptionReview'),'low','review publication is low risk');
select is(komisio_private.operation_risk('saveInspectionDraft'),'low','inspection edit is low risk');
select throws_like($$select komisio_private.operation_risk('notAKind')$$,'%INVALID_INPUT%','unknown kind has no risk');
select is(komisio_private.valid_operation_payload('notAKind','{}'::jsonb),false,'unknown kind never validates');
insert into auth.users(id,email,email_confirmed_at) values('e0000000-0000-4000-8000-000000000001','staff@dispatch.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Dispatch','dispatch-test',gen_random_uuid())::text,true);
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'notAKind','{}'::jsonb,'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','dispatcher rejects an unknown kind before any preflight');
-- Existing behaviour is proven unchanged by 0015 and 0017 to 0019 running against this migration.
select * from finish();
rollback;
