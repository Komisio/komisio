begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('acceptItem'),'medium','acceptance is medium risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000101','accept-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000102','accept-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000101","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Staged accept test','staged-accept-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@accept.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 '[{"id":"f0000000-0000-4000-8000-000000000111","kind":"observation","reference":"Staff","observation":"Synthetic coat"},{"id":"f0000000-0000-4000-8000-000000000112","kind":"price-evidence","reference":"Staff estimate","observation":"300 SEK"}]'::jsonb);
select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,
 '{"metadata":{"description":{"value":"Synthetic coat","sourceIds":["f0000000-0000-4000-8000-000000000111"],"certainty":"observed"}},"price":{"currency":"SEK","amount":"300.00","rationale":"Staff estimate","sourceIds":["f0000000-0000-4000-8000-000000000112"]},"questions":[]}'::jsonb,now()+interval '1 day');
create temp view payload as select jsonb_build_object('originKind','reception_review','originId',current_setting('test.session'),'originRevision',1,'priceOre',32000) as p;
-- Structural validation.
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || '{"priceOre":0}','agent',now()+interval '1 day')$$,'%INVALID_INPUT%','zero price rejected');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || '{"priceOre":"320.00"}','agent',now()+interval '1 day')$$,'%INVALID_INPUT%','text price rejected');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || '{"originRevision":null}','agent',now()+interval '1 day')$$,'%INVALID_INPUT%','review origin needs a revision');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || '{"extra":true}','agent',now()+interval '1 day')$$,'%INVALID_INPUT%','unknown key rejected');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || '{"originKind":"sale"}','agent',now()+interval '1 day')$$,'%INVALID_INPUT%','unknown origin kind rejected');
-- Preflight: current-state preconditions.
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload),'agent',now()+interval '1 day')$$,'%CUSTODY_REQUIRED%','no custody, no proposal');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || '{"originRevision":2}','agent',now()+interval '1 day')$$,'%RECEPTION_REVIEW_CHANGED%','stale review version rejected at proposal');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload) || jsonb_build_object('originId',gen_random_uuid()),'agent',now()+interval '1 day')$$,'%ORIGIN_NOT_FOUND%','unknown session rejected');
select set_config('test.op',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op')::uuid,'acceptItem',(select p from payload),'accept-agent',now()+interval '1 day'),current_setting('test.op')::uuid,'agent proposal staged');
select is((select risk_level from pending_operations where id=current_setting('test.op')::uuid),'medium','stored at medium risk');
select is((select count(*) from items),0::bigint,'nothing accepted by proposing');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'open',null,null,'acceptItem')),1::bigint,'queue filters by the new kind');
-- The proposer's own identity may not approve a medium-risk kind.
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op')::uuid,'approved','')$$,'42501',null,'self-approval denied');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000102','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000102","role":"authenticated"}';
select set_config('test.decision',gen_random_uuid()::text,true);
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.decision')::uuid,current_setting('test.op')::uuid,'approved','Checked the garment')$$,'a second person approves');
select is((select outcome from operation_decisions where id=current_setting('test.decision')::uuid),'executed','approval executed acceptance');
select is((select result_id from operation_decisions where id=current_setting('test.decision')::uuid),current_setting('test.op')::uuid,'the item id is the operation id');
select is((select accepted_by from items where id=current_setting('test.op')::uuid),'f0000000-0000-4000-8000-000000000102'::uuid,'the approver accepted, not the proposer');
select is((select price_ore from item_prices where item_id=current_setting('test.op')::uuid),32000::bigint,'proposed price frozen');
select is((select detail->'stagedOperation'->>'operationId' from item_events where item_id=current_setting('test.op')::uuid and kind='provenance'),null,'the review itself was staff-published, so provenance cites no staged origin');
-- A second proposal for the same origin fails at preflight, and a stale approval fails at execution.
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'acceptItem',(select p from payload),'accept-agent',now()+interval '1 day')$$,'%ITEM_EXISTS%','accepted origin cannot be proposed again');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000101","role":"authenticated"}';
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',15000,'Receipt 3',false)::text,true);
select set_config('test.op2',gen_random_uuid()::text,true);
select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op2')::uuid,'acceptItem',jsonb_build_object('originKind','purchase','originId',current_setting('test.purchase'),'originRevision',null,'priceOre',25000),'accept-agent',now()+interval '1 day');
select set_config('test.op3',gen_random_uuid()::text,true);
select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op3')::uuid,'acceptItem',jsonb_build_object('originKind','purchase','originId',current_setting('test.purchase'),'originRevision',null,'priceOre',26000),'accept-agent',now()+interval '1 day');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000102","role":"authenticated"}';
select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op2')::uuid,'approved','');
select set_config('test.decision3',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.decision3')::uuid,current_setting('test.op3')::uuid,'approved','');
select is((select outcome from operation_decisions where id=current_setting('test.decision3')::uuid),'failed','competing proposal fails at execution');
select is((select error_code from operation_decisions where id=current_setting('test.decision3')::uuid),'ITEM_EXISTS','with the engine error code');
select is((select count(*) from items where origin_id=current_setting('test.purchase')::uuid),1::bigint,'one item per origin holds');
select * from finish();
rollback;
