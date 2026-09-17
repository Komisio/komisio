begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000000061','queue-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000061","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Queue mode test','queue-mode-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@queue.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
create temp view stage_of as select stage from reception_queue(current_setting('test.tenant')::uuid) where session_id=current_setting('test.session')::uuid;
select is((select stage from stage_of),'preparing','no review yet');
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 '[{"id":"f0000000-0000-4000-8000-000000000071","kind":"observation","reference":"Staff","observation":"Synthetic coat"},{"id":"f0000000-0000-4000-8000-000000000072","kind":"price-evidence","reference":"Staff estimate","observation":"300 SEK"}]'::jsonb);
select set_config('test.suggestions','{"attributes":[{"slug":"description","definitionVersion":1,"value":"Synthetic coat","sourceIds":["f0000000-0000-4000-8000-000000000071"],"certainty":"observed"}],"price":{"currency":"SEK","amount":"300.00","rationale":"Staff estimate","sourceIds":["f0000000-0000-4000-8000-000000000072"]},"questions":[]}',true);
select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day');
select is((select stage from stage_of),'awaiting_custody','delegated default: a current review needs custody, not a seller answer');
-- Per-item mode brings back the seller link flow before custody.
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select set_config('test.policy',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"sellerReviewMode":"per_item"}')::text,true);
select is((select stage from stage_of),'ready_to_share','per_item: the seller must be asked');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'');
select is((select stage from stage_of),'ready_to_share','per_item: custody alone does not skip the seller');
-- Back to delegated: custody now exists, so the item can be accepted.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,current_setting('test.body')::jsonb);
select is((select stage from stage_of),'ready_to_accept','delegated with custody: ready to accept');
select is((select count(*) from reception_queue(current_setting('test.tenant')::uuid,'ready_to_accept')),1::bigint,'stage filter accepts the new stage');
select throws_like($$select * from reception_queue(current_setting('test.tenant')::uuid,'approved')$$,'%INVALID_INPUT%','the old approved stage is gone');
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'reception_review',current_setting('test.session')::uuid,1,32000);
select is((select stage from stage_of),'accepted','accepted item ends the queue work');
-- New evidence after acceptance still surfaces as needs_review for a person to judge.
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,
 '[{"id":"f0000000-0000-4000-8000-000000000073","kind":"observation","reference":"Staff","observation":"Synthetic coat, mended"},{"id":"f0000000-0000-4000-8000-000000000072","kind":"price-evidence","reference":"Staff estimate","observation":"300 SEK"}]'::jsonb);
select is((select stage from stage_of),'needs_review','changed evidence outranks acceptance in the work list');
select * from finish();
rollback;
