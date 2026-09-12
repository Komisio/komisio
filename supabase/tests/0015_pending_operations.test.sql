begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('c0000000-0000-4000-8000-000000000001','staff@ops.test',now()),
 ('c0000000-0000-4000-8000-000000000002','agent-user@ops.test',now()),
 ('c0000000-0000-4000-8000-000000000003','reader@ops.test',now()),
 ('c0000000-0000-4000-8000-000000000004','outsider@ops.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Ops','ops-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','seller@ops.test','')::text,true);
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.terms',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'TEST','Fictional terms','en',false)::text,true);
select set_config('test.sources','[{"id":"c0000000-0000-4000-8000-000000000010","kind":"observation","reference":"TEST","observation":"Blue jacket"},{"id":"c0000000-0000-4000-8000-000000000011","kind":"price-evidence","reference":"TEST appraisal","observation":"Fictional 250 SEK"}]',true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb);
select set_config('test.suggestions','{"metadata":{"description":{"value":"Blue jacket","sourceIds":["c0000000-0000-4000-8000-000000000010"],"certainty":"observed"}},"price":{"currency":"SEK","amount":"250.00","rationale":"TEST","sourceIds":["c0000000-0000-4000-8000-000000000011"]},"questions":[]}',true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000002','staff'),
 (current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000003','readonly');
set local role authenticated;
-- The agent runs under a staff member's session and proposes; nothing is published.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.payload',jsonb_build_object('sessionId',current_setting('test.session'),'sourceRevision',1,'previousReviewId',null,'agreementId',current_setting('test.terms'),'expiresAt',(now()+interval '1 day')::text,'suggestions',current_setting('test.suggestions')::jsonb)::text,true);
select set_config('test.op1',gen_random_uuid()::text,true);
select lives_ok($$select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op1')::uuid,'publishReceptionReview',current_setting('test.payload')::jsonb,'test-agent',now()+interval '1 day')$$,'agent proposes a review publication');
select is((select count(*) from reception_reviews),0::bigint,'proposal publishes nothing');
select is((select risk_level from pending_operations),'low','risk derives from the kind');
select is((select actor_kind from pending_operations),'agent','proposal carries a non-human actor kind');
select lives_ok($$select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op1')::uuid,'publishReceptionReview',current_setting('test.payload')::jsonb,'test-agent',now()+interval '1 day')$$,'identical retry succeeds');
select is((select count(*) from pending_operations),1::bigint,'retry persists once');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op1')::uuid,'publishReceptionReview',current_setting('test.payload')::jsonb,'other-agent',now()+interval '1 day')$$,'%REQUEST_CONFLICT%','retry binds exact proposal');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'deleteTenant',current_setting('test.payload')::jsonb,'test-agent',now()+interval '1 day')$$,'%INVALID_INPUT%','unknown kind rejected');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',current_setting('test.payload')::jsonb||'{"risk":"low"}'::jsonb,'test-agent',now()+interval '1 day')$$,'%INVALID_INPUT%','extra payload key rejected');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',jsonb_set(current_setting('test.payload')::jsonb,'{sourceRevision}','2'),'test-agent',now()+interval '1 day')$$,'%RECEPTION_CHANGED%','stale source revision rejected at proposal');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',jsonb_set(current_setting('test.payload')::jsonb,'{suggestions,metadata,description,sourceIds}','["c0000000-0000-4000-8000-000000000099"]'),'test-agent',now()+interval '1 day')$$,'%RECEPTION_UNKNOWN_SOURCE%','unknown source rejected at proposal');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',jsonb_set(current_setting('test.payload')::jsonb,'{suggestions,price,sourceIds}','["c0000000-0000-4000-8000-000000000010"]'),'test-agent',now()+interval '1 day')$$,'%RECEPTION_PRICE_EVIDENCE_REQUIRED%','price must cite price evidence');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',jsonb_set(current_setting('test.payload')::jsonb,'{suggestions,metadata,description,certainty}','"tentative"'),'test-agent',now()+interval '1 day')$$,'%INVALID_INPUT%','tentative facts cannot be proposed for publication');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',current_setting('test.payload')::jsonb,'test-agent',now()+interval '8 days')$$,'%INVALID_INPUT%','proposal expiry bounded');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',jsonb_set(current_setting('test.payload')::jsonb,'{agreementId}',to_jsonb(gen_random_uuid()::text)),'test-agent',now()+interval '1 day')$$,'%AGREEMENT_CHANGED%','terms must be current');
-- Readonly and outsiders can neither propose nor decide.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'publishReceptionReview',current_setting('test.payload')::jsonb,'test-agent',now()+interval '1 day')$$,'42501',null,'readonly cannot propose');
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op1')::uuid,'approved','')$$,'42501',null,'readonly cannot decide');
select is((select status from operation_queue(current_setting('test.tenant')::uuid)),'open','readonly sees the open proposal');
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$select * from operation_queue(current_setting('test.tenant')::uuid)$$,'42501',null,'outsider denied queue');
select is((select count(*) from pending_operations),0::bigint,'outsider sees no proposals');
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op1')::uuid,'approved','')$$,'42501',null,'outsider cannot decide');
-- Staff approval executes the same engine function as the approver.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.dec1',gen_random_uuid()::text,true);
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op1')::uuid,'approved','Checked')$$,'staff approves');
select is((select outcome from operation_decisions),'executed','approval executed the operation');
select is((select count(*) from reception_reviews),1::bigint,'one review published');
select is((select id from reception_reviews),current_setting('test.op1')::uuid,'review id is the operation id');
select is((select created_by from reception_reviews),'c0000000-0000-4000-8000-000000000001'::uuid,'the approver is the recorded actor');
select is((select result_id from operation_decisions),current_setting('test.op1')::uuid,'decision links the result');
select is((select status from operation_queue(current_setting('test.tenant')::uuid)),'executed','queue reports execution');
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op1')::uuid,'approved','Checked')$$,'identical decision retry succeeds');
select is((select count(*) from operation_decisions),1::bigint,'decision persists once');
select throws_like($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op1')::uuid,'rejected','Checked')$$,'%REQUEST_CONFLICT%','retry cannot change the decision');
select throws_like($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op1')::uuid,'approved','')$$,'%OPERATION_DECIDED%','one decision per operation');
select throws_like($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid(),'approved','')$$,'%OPERATION_NOT_FOUND%','unknown operation');
-- A proposal that becomes stale before approval fails at execution and records the failure.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.payload2',jsonb_set(current_setting('test.payload')::jsonb,'{previousReviewId}',to_jsonb(current_setting('test.op1')))::text,true);
select set_config('test.op2',gen_random_uuid()::text,true);
select lives_ok($$select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op2')::uuid,'publishReceptionReview',current_setting('test.payload2')::jsonb,'test-agent',now()+interval '1 day')$$,'second proposal against current review');
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.sources')::jsonb);
select set_config('test.dec2',gen_random_uuid()::text,true);
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec2')::uuid,current_setting('test.op2')::uuid,'approved','')$$,'approval of a stale proposal does not raise');
select is((select outcome from operation_decisions where id=current_setting('test.dec2')::uuid),'failed','stale execution recorded as failed');
select alike((select error_code from operation_decisions where id=current_setting('test.dec2')::uuid),'%RECEPTION_CHANGED%','failure code retained');
select is((select count(*) from reception_reviews),1::bigint,'failed execution published nothing');
select throws_like($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op2')::uuid,'approved','')$$,'%OPERATION_DECIDED%','failed operation cannot be retried; propose again');
-- Rejection records a reason and executes nothing.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.payload3',jsonb_set(current_setting('test.payload2')::jsonb,'{sourceRevision}','2')::text,true);
select set_config('test.op3',gen_random_uuid()::text,true);
select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op3')::uuid,'publishReceptionReview',current_setting('test.payload3')::jsonb,'test-agent',now()+interval '1 day');
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op3')::uuid,'rejected','Wrong garment')$$,'staff rejects');
select is((select reason from operation_decisions where operation_id=current_setting('test.op3')::uuid),'Wrong garment','reason retained');
select is((select count(*) from reception_reviews),1::bigint,'rejection published nothing');
-- Low-risk proposals may be approved from the same session that proposed them.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.op4',gen_random_uuid()::text,true);
select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op4')::uuid,'publishReceptionReview',current_setting('test.payload3')::jsonb,'test-agent',now()+interval '1 day');
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op4')::uuid,'approved','')$$,'low-risk self-approval allowed');
select is((select count(*) from reception_reviews),2::bigint,'second review published');
-- Expired proposals cannot be approved but can still be rejected.
reset role;
insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values('c0000000-0000-4000-8000-000000000050',current_setting('test.tenant')::uuid,'publishReceptionReview','low',current_setting('test.payload3')::jsonb,'agent','test-agent','c0000000-0000-4000-8000-000000000002',now()-interval '1 hour');
set local role authenticated;
select is((select status from operation_queue(current_setting('test.tenant')::uuid) where id='c0000000-0000-4000-8000-000000000050'),'expired','queue derives expiry');
select throws_like($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'c0000000-0000-4000-8000-000000000050','approved','')$$,'%OPERATION_EXPIRED%','expired proposal cannot execute');
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'c0000000-0000-4000-8000-000000000050','rejected','Expired')$$,'expired proposal can be rejected');
-- Higher risk kinds require a different approver; simulated by a direct row.
reset role;
insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values('c0000000-0000-4000-8000-000000000051',current_setting('test.tenant')::uuid,'publishReceptionReview','medium',current_setting('test.payload3')::jsonb,'agent','test-agent','c0000000-0000-4000-8000-000000000002',now()+interval '1 hour');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'c0000000-0000-4000-8000-000000000051','approved','')$$,'42501',null,'medium risk forbids self-approval');
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- Records are immutable and cannot be written directly.
select throws_ok($$insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at) values(gen_random_uuid(),current_setting('test.tenant')::uuid,'publishReceptionReview','low','{}','agent','x','c0000000-0000-4000-8000-000000000001',now())$$,'42501',null,'no direct proposal insert');
select throws_ok($$insert into operation_decisions(id,tenant_id,operation_id,decision,outcome,decided_by) values(gen_random_uuid(),current_setting('test.tenant')::uuid,current_setting('test.op3')::uuid,'rejected','rejected','c0000000-0000-4000-8000-000000000001')$$,'42501',null,'no direct decision insert');
reset role;
select throws_like($$update pending_operations set risk_level='high'$$,'%IMMUTABLE_OPERATION%','proposals immutable');
select throws_like($$delete from operation_decisions$$,'%IMMUTABLE_OPERATION%','decisions immutable');
select is((select count(*) from access_events where action='operation.proposed'),4::bigint,'proposals audited');
select is((select count(*) from access_events where action='operation.decided'),5::bigint,'decisions audited');
-- MFA and anonymous access.
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'c0000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op3')::uuid,'rejected','')$$,'42501',null,'MFA enforced on decisions');
set local role anon;
select throws_ok($$select * from pending_operations$$,'42501',null,'anonymous cannot read');
select throws_ok($$select propose_operation(null,null,null,null,null,null)$$,'42501',null,'anonymous cannot propose');
select * from finish();
rollback;
