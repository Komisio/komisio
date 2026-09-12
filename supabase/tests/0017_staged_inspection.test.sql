begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d0000000-0000-4000-8000-000000000001','owner@draft-ops.test',now()),
 ('d0000000-0000-4000-8000-000000000002','agent@draft-ops.test',now()),
 ('d0000000-0000-4000-8000-000000000003','reader@draft-ops.test',now()),
 ('d0000000-0000-4000-8000-000000000004','outsider@draft-ops.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Draft ops','draft-ops',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','seller@draft-ops.test','')::text,true);
select set_config('test.bag',receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'')::text,true);
select set_config('test.otherbag',receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'')::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Original','Garment','Good');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'d0000000-0000-4000-8000-000000000002','staff'),
 (current_setting('test.tenant')::uuid,'d0000000-0000-4000-8000-000000000003','readonly');
create function pg_temp.propose(payload jsonb, id uuid default gen_random_uuid()) returns uuid language sql as $$
 select propose_operation(current_setting('test.tenant')::uuid,id,'saveInspectionDraft',payload,'draft-agent',now()+interval '1 day') $$;
create function pg_temp.decide(id uuid, decision text default 'approved') returns uuid language sql as $$
 select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),id,decision,'Fixture review') $$;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.payload',jsonb_build_object('bagId',current_setting('test.bag'),'draftId',current_setting('test.draft'),'expectedRevision',1,'fields',jsonb_build_object('description','Changed','category','','condition','Good'))::text,true);
select set_config('test.op',gen_random_uuid()::text,true);
select lives_ok($$select pg_temp.propose(current_setting('test.payload')::jsonb,current_setting('test.op')::uuid)$$,'stages existing descriptive edit');
select is((select count(*) from inspection_draft_revisions),1::bigint,'proposing saves nothing');
select is((select risk_level from pending_operations),'low','inspection risk derives from kind');
select lives_ok($$select pg_temp.propose(current_setting('test.payload')::jsonb,current_setting('test.op')::uuid)$$,'identical envelope retries');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{fields,description}','"Different"'),current_setting('test.op')::uuid)$$,'%REQUEST_CONFLICT%','retry cannot change payload');
select throws_like($$select pg_temp.propose(current_setting('test.payload')::jsonb || '{"approved":true}')$$,'%INVALID_INPUT%','authority keys denied');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{fields,price}','"50.00"'))$$,'%INVALID_INPUT%','financial fields denied');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{fields,description}','""'))$$,'%INVALID_INPUT%','empty description denied');
select throws_like($$select pg_temp.propose(current_setting('test.payload')::jsonb - 'fields')$$,'%INVALID_INPUT%','missing fields denied');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{expectedRevision}','0'))$$,'%INVALID_INPUT%','new drafts are outside kind');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{expectedRevision}','2'))$$,'%INSPECTION_DRAFT_CHANGED%','stale base denied');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{bagId}',to_jsonb(current_setting('test.otherbag'))))$$,'%INSPECTION_NOT_FOUND%','wrong bag denied');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload')::jsonb,'{fields}','{"description":"Original","category":"Garment","condition":"Good"}'))$$,'%INSPECTION_UNCHANGED%','no-op denied');
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select pg_temp.propose(current_setting('test.payload')::jsonb)$$,'42501',null,'readonly cannot propose');
select throws_ok($$select pg_temp.decide(current_setting('test.op')::uuid)$$,'42501',null,'readonly cannot approve');
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*) from pending_operations),0::bigint,'outsider cannot read');
select throws_ok($$select pg_temp.decide(current_setting('test.op')::uuid)$$,'42501',null,'outsider cannot decide');
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.decision',pg_temp.decide(current_setting('test.op')::uuid)::text,true);
select is((select outcome from operation_decisions),'executed','approval executes');
select is((select count(*) from inspection_draft_revisions),2::bigint,'one new revision');
select is((select description from inspection_current),'Changed','approved text saved');
select is((select category from inspection_current),'','explicit clearing saved');
select is((select created_by from inspection_current),'d0000000-0000-4000-8000-000000000001'::uuid,'approver is revision actor');
select is((select result_id from operation_decisions),current_setting('test.op')::uuid,'result links immutable revision');
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.decision')::uuid,current_setting('test.op')::uuid,'approved','Fixture review')$$,'approval retry returns original');
select is((select count(*) from inspection_draft_revisions),2::bigint,'retry does not save again');
select throws_like($$select pg_temp.decide(current_setting('test.op')::uuid)$$,'%OPERATION_DECIDED%','second decision denied');
select set_config('test.payload2',jsonb_set(jsonb_set(current_setting('test.payload')::jsonb,'{expectedRevision}','2'),'{fields,description}','"Next"')::text,true);
select set_config('test.stale',pg_temp.propose(current_setting('test.payload2')::jsonb)::text,true);
select set_config('test.reject',pg_temp.propose(current_setting('test.payload2')::jsonb)::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,2,'Staff edit','','Good');
select lives_ok($$select pg_temp.decide(current_setting('test.stale')::uuid)$$,'stale execution is recorded');
select is((select outcome from operation_decisions where operation_id=current_setting('test.stale')::uuid),'failed','stale failed outcome');
select is((select error_code from operation_decisions where operation_id=current_setting('test.stale')::uuid),'INSPECTION_DRAFT_CHANGED','stale error retained');
select lives_ok($$select pg_temp.decide(current_setting('test.reject')::uuid,'rejected')$$,'stale proposal can be rejected');
select is((select description from inspection_current),'Staff edit','no stale overwrite');
select set_config('test.payload3',jsonb_set(current_setting('test.payload2')::jsonb,'{expectedRevision}','3')::text,true);
select set_config('test.archived',pg_temp.propose(current_setting('test.payload3')::jsonb)::text,true);
select set_inspection_archived(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,3,true,'Archived by staff');
select lives_ok($$select pg_temp.decide(current_setting('test.archived')::uuid)$$,'archiving prevents execution');
select is((select outcome from operation_decisions where operation_id=current_setting('test.archived')::uuid),'failed','archived execution failed');
select throws_like($$select pg_temp.propose(jsonb_set(current_setting('test.payload3')::jsonb,'{expectedRevision}','4'))$$,'%INSPECTION_ARCHIVED%','archived proposal denied');
select is((select count(*) from inspection_draft_revisions),4::bigint,'failures/rejection created no revision');
reset role;
select throws_like($$update pending_operations set payload='{}'$$,'%IMMUTABLE_OPERATION%','inspection proposals immutable');
insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values('d0000000-0000-4000-8000-000000000099',current_setting('test.tenant')::uuid,'saveInspectionDraft','low',current_setting('test.payload3')::jsonb,'agent','fixture','d0000000-0000-4000-8000-000000000001',now()-interval '1 hour');
set local role authenticated;
select throws_like($$select pg_temp.decide('d0000000-0000-4000-8000-000000000099')$$,'%OPERATION_EXPIRED%','expired approval denied');
select lives_ok($$select pg_temp.decide('d0000000-0000-4000-8000-000000000099','rejected')$$,'expired rejection allowed');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'d0000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
select throws_ok($$select pg_temp.propose(current_setting('test.payload3')::jsonb)$$,'42501',null,'MFA required for proposing');
select throws_ok($$select pg_temp.decide(current_setting('test.op')::uuid)$$,'42501',null,'MFA required for deciding');
select * from finish();
rollback;
