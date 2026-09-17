begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000081','prov-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000082','prov-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000081","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Provenance test','provenance-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@prov.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
-- Garment path with a model attempt; published reviews carry only observed facts.
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 '[{"id":"f0000000-0000-4000-8000-000000000091","kind":"observation","reference":"Staff","observation":"Synthetic coat, wool"},{"id":"f0000000-0000-4000-8000-000000000092","kind":"price-evidence","reference":"Staff estimate","observation":"300 SEK"}]'::jsonb);
reset role;
insert into public.reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version)
 values('f0000000-0000-4000-8000-000000000093',current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,1,'f0000000-0000-4000-8000-000000000081','synthetic-model','p1');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000081","role":"authenticated"}';
select set_config('test.review',gen_random_uuid()::text,true);
select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,
 '{"attributes":[{"slug":"description","definitionVersion":1,"value":"Synthetic coat","sourceIds":["f0000000-0000-4000-8000-000000000091"],"certainty":"observed"},{"slug":"material","definitionVersion":1,"value":"Wool","sourceIds":["f0000000-0000-4000-8000-000000000091"],"certainty":"observed"}],"price":{"currency":"SEK","amount":"300.00","rationale":"Staff estimate","sourceIds":["f0000000-0000-4000-8000-000000000092"]},"questions":[]}'::jsonb,now()+interval '1 day');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'reception_review',current_setting('test.session')::uuid,1,30000);
select set_config('test.prov',(select detail::text from item_events where item_id=current_setting('test.item')::uuid and kind='provenance'),true);
select is((select count(*) from item_events where item_id=current_setting('test.item')::uuid and kind='provenance'),1::bigint,'one provenance event per item');
select is(current_setting('test.prov')::jsonb->>'reviewedBy','f0000000-0000-4000-8000-000000000081','cites who published the review');
select is(current_setting('test.prov')::jsonb->>'reviewId',current_setting('test.review'),'cites the exact review');
select is(current_setting('test.prov')::jsonb->'facts','{"description":"observed","material":"observed"}'::jsonb,'per-fact certainty copied');
select is(current_setting('test.prov')::jsonb->'modelAttempts'->0->>'model','synthetic-model','model attempt on the reviewed revision cited');
select is(current_setting('test.prov')::jsonb->'modelAttempts'->0->>'id','f0000000-0000-4000-8000-000000000093','attempt id cited');
select is(current_setting('test.prov')::jsonb->>'stagedOperation',null,'no agent proposal behind a staff review');
select is((current_setting('test.prov')::jsonb->'priceSourceIds')->>0,'f0000000-0000-4000-8000-000000000092','price evidence source cited');
select ok(not(current_setting('test.prov')::jsonb ? 'value') and current_setting('test.prov')::text not like '%Synthetic coat%','provenance carries facts, not text');
-- Bag path: a draft saved by an agent proposal cites the staged operation and its approver.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic scarf','Accessories','Fair');
-- Agents may only edit an existing draft: the proposal produces revision 2.
select set_config('test.op',gen_random_uuid()::text,true);
select propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op')::uuid,'saveInspectionDraft',
 jsonb_build_object('bagId',current_setting('test.bag'),'draftId',current_setting('test.draft'),'expectedRevision',1,'fields',jsonb_build_object('description','Synthetic scarf, silk','category','Accessories','condition','Fair')),'prov-agent',now()+interval '1 day');
select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op')::uuid,'approved','');
select is((select outcome from operation_decisions where operation_id=current_setting('test.op')::uuid),'executed','fixture draft was created by the staged proposal');
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'inspection_draft',current_setting('test.draft')::uuid,2,9900);
select set_config('test.prov2',(select detail::text from item_events where item_id=current_setting('test.item2')::uuid and kind='provenance'),true);
select is(current_setting('test.prov2')::jsonb->'stagedOperation'->>'operationId',current_setting('test.op'),'agent proposal cited');
select is(current_setting('test.prov2')::jsonb->'stagedOperation'->>'actorLabel','prov-agent','agent label cited');
select is(current_setting('test.prov2')::jsonb->'stagedOperation'->>'decidedBy','f0000000-0000-4000-8000-000000000081','approver cited');
select is((current_setting('test.prov2')::jsonb->>'revision')::int,2,'draft revision cited');
-- Purchases carry no origin provenance.
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',15000,'Receipt 9',false)::text,true);
select set_config('test.item3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item3')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000);
select is((select count(*) from item_events where item_id=current_setting('test.item3')::uuid and kind='provenance'),0::bigint,'purchase has no provenance event');
select throws_ok($$update item_events set detail='{}' where kind='provenance'$$,'42501',null,'provenance immutable for members');
reset role;
select throws_like($$update item_events set detail='{}' where kind='provenance'$$,'%IMMUTABLE_ITEM%','provenance immutable for privileged roles');
select ok(not has_function_privilege('authenticated','komisio_private.item_provenance(uuid,text,uuid)','execute'),'helper is private');
select * from finish();
rollback;
