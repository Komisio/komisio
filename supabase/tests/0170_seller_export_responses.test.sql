begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Owner of store A (911), the exported seller's own account (912), another
-- seller's account (913), owner of store B (914), staff/readonly/admin of A (915-917).
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000911','resp-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000912','resp-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000000913','resp-other-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000000914','resp-other-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000915','resp-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000916','resp-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000000917','resp-admin@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000911","role":"authenticated"}';
select set_config('test.a',create_tenant('Response export A','response-export-a',gen_random_uuid())::text,true);
select set_config('test.s1',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Synthetic exported seller','resp-seller@example.test','')::text,true);
select set_config('test.s2',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Synthetic other seller','resp-other-seller@example.test','')::text,true);
select set_config('test.s3',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Synthetic silent seller','resp-silent@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.a')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select set_config('test.sources','[{"id":"a1700000-0000-4000-8000-000000000010","kind":"observation","reference":"TEST","observation":"Blue jacket"},{"id":"a1700000-0000-4000-8000-000000000011","kind":"price-evidence","reference":"TEST appraisal","observation":"Fictional 250 SEK appraisal"}]',true);
select set_config('test.suggestions','{"attributes":[{"slug":"description","definitionVersion":1,"value":"Blue jacket","sourceIds":["a1700000-0000-4000-8000-000000000010"],"certainty":"observed"}],"price":{"currency":"SEK","amount":"250.00","rationale":"TEST appraisal","sourceIds":["a1700000-0000-4000-8000-000000000011"]},"questions":[]}',true);
-- One published review per session; staff issues the seller's link (hash stored, bearer never stored).
create function pg_temp.publish_for(p_tenant uuid,p_seller uuid,p_review uuid,p_token text) returns void language plpgsql as $$
declare session uuid:=gen_random_uuid();
begin
 perform create_reception_session(p_tenant,session,p_seller);
 perform save_reception_sources(p_tenant,gen_random_uuid(),session,0,current_setting('test.sources')::jsonb);
 perform publish_reception_review(p_tenant,p_review,session,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day');
 perform set_reception_access(p_tenant,gen_random_uuid(),p_review,null,encode(sha256(convert_to(p_token,'UTF8')),'hex'));
end $$;
select pg_temp.publish_for(current_setting('test.a')::uuid,current_setting('test.s1')::uuid,'a1700000-0000-4000-8000-000000000101',repeat('a',64));
select pg_temp.publish_for(current_setting('test.a')::uuid,current_setting('test.s1')::uuid,'a1700000-0000-4000-8000-000000000102',repeat('b',64));
select pg_temp.publish_for(current_setting('test.a')::uuid,current_setting('test.s2')::uuid,'a1700000-0000-4000-8000-000000000103',repeat('c',64));
-- Store B has a seller with the same email and its own review.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000914","role":"authenticated"}';
select set_config('test.b',create_tenant('Response export B','response-export-b',gen_random_uuid())::text,true);
select set_config('test.sb',register_seller(current_setting('test.b')::uuid,gen_random_uuid(),'Synthetic same email elsewhere','resp-seller@example.test','')::text,true);
select set_config('test.agreement_b',publish_seller_agreement(current_setting('test.b')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select set_config('test.agreement',current_setting('test.agreement_b'),true);
select pg_temp.publish_for(current_setting('test.b')::uuid,current_setting('test.sb')::uuid,'b1700000-0000-4000-8000-000000000104',repeat('d',64));
-- The sellers answer: S1 approves one review and declines the other; S2 and the store-B seller approve theirs.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000912","role":"authenticated"}';
select respond_to_reception_review(repeat('a',64),'a1700000-0000-4000-8000-000000000201','a1700000-0000-4000-8000-000000000101','approve');
select respond_to_reception_review(repeat('b',64),'a1700000-0000-4000-8000-000000000202','a1700000-0000-4000-8000-000000000102','decline');
select respond_to_reception_review(repeat('d',64),'b1700000-0000-4000-8000-000000000204','b1700000-0000-4000-8000-000000000104','approve');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000913","role":"authenticated"}';
select respond_to_reception_review(repeat('c',64),'a1700000-0000-4000-8000-000000000203','a1700000-0000-4000-8000-000000000103','approve');
-- Members of A for the role checks.
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.a')::uuid,'f0000000-0000-4000-8000-000000000915','staff'),
 (current_setting('test.a')::uuid,'f0000000-0000-4000-8000-000000000916','readonly'),
 (current_setting('test.a')::uuid,'f0000000-0000-4000-8000-000000000917','admin');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000911","role":"authenticated"}';
select set_config('test.export',seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)::text,true);
-- Envelope and content.
select is(jsonb_typeof(current_setting('test.export')::jsonb->'receptionResponses'),'array','responses have an array envelope');
select is(jsonb_array_length(current_setting('test.export')::jsonb->'receptionResponses'),2,'both of the seller''s own decisions included');
select is((select jsonb_agg(x->>'decision' order by x->>'decision') from jsonb_array_elements(current_setting('test.export')::jsonb->'receptionResponses') x),'["approve","decline"]'::jsonb,'approve and decline both included');
select is(current_setting('test.export')::jsonb->'receptionResponses'->0->>'id','a1700000-0000-4000-8000-000000000201','ordered by time then id: the approval first');
select is(current_setting('test.export')::jsonb->'receptionResponses'->1->>'id','a1700000-0000-4000-8000-000000000202','the decline second');
select is(current_setting('test.export')::jsonb->'receptionResponses'->1->>'review_id','a1700000-0000-4000-8000-000000000102','a response names its review');
select is(current_setting('test.export')::jsonb->'receptionResponses'->0->>'created_by','f0000000-0000-4000-8000-000000000912','the responder is the seller''s own account');
select is((select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(x) k from jsonb_array_elements(current_setting('test.export')::jsonb->'receptionResponses') x) keys),'["created_at","created_by","decision","id","review_id"]'::jsonb,'exactly the retained fields, no tenant or access pointer');
select is(position('access_id' in current_setting('test.export')),0,'no access pointer anywhere in the document');
select is(position('token_hash' in current_setting('test.export')),0,'no token hash anywhere in the document');
select is(position('a1700000-0000-4000-8000-000000000203' in current_setting('test.export')),0,'another seller''s response in the same store excluded');
select is(position('b1700000-0000-4000-8000-000000000204' in current_setting('test.export')),0,'the same-email seller''s response in another store excluded');
select is(current_setting('test.export')::jsonb->'receptionResponses',
 (select jsonb_agg(to_jsonb(r)-'tenant_id'-'access_id' order by r.created_at,r.id) from reception_responses r
   join reception_reviews v on v.tenant_id=r.tenant_id and v.id=r.review_id
   join reception_sessions s on s.tenant_id=v.tenant_id and s.id=v.session_id
   where r.tenant_id=current_setting('test.a')::uuid and s.seller_id=current_setting('test.s1')::uuid),
 'rows exact and deterministically ordered');
-- The rest of the export is unchanged.
select is(jsonb_array_length(current_setting('test.export')::jsonb->'receptionReviews'),2,'the seller''s reviews still exported');
select is(jsonb_typeof(current_setting('test.export')::jsonb->'handovers'),'array','handovers array retained');
select is(current_setting('test.export')::jsonb->>'tenantId',current_setting('test.a'),'document header unchanged');
select is((select count(*) from access_events where tenant_id=current_setting('test.a')::uuid and action='seller.exported' and target_id=current_setting('test.s1')::uuid),1::bigint,'one export access event');
select is(seller_data_export(current_setting('test.a')::uuid,current_setting('test.s3')::uuid)->'receptionResponses','[]'::jsonb,'a seller without reviews has an empty array');
-- Scope both ways: store B exports only its own response for its own seller.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000914","role":"authenticated"}';
select is(jsonb_array_length(seller_data_export(current_setting('test.b')::uuid,current_setting('test.sb')::uuid)->'receptionResponses'),1,'store B sees its own response only');
select is(seller_data_export(current_setting('test.b')::uuid,current_setting('test.sb')::uuid)->'receptionResponses'->0->>'id','b1700000-0000-4000-8000-000000000204','and it is the store B response');
select throws_ok($$select seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'store B''s owner cannot export a store A seller');
-- Roles.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000915","role":"authenticated"}';
select throws_ok($$select seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'staff refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000916","role":"authenticated"}';
select throws_ok($$select seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'readonly refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000917","role":"authenticated"}';
select is(jsonb_array_length(seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)->'receptionResponses'),2,'admin exports the complete document');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000912","role":"authenticated"}';
select throws_ok($$select seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'the seller''s own account is not staff and cannot export');
set local role anon;
select throws_ok($$select seller_data_export(current_setting('test.a')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'anonymous execution refused');
select * from finish();
rollback;
