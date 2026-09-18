begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000981','quick-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000982','quick-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000981","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Quick intake','quick-intake-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','quick-seller@example.test','')::text,true);
select set_config('test.other',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Other seller','quick-other@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
-- Policy: the profile key is validated; absent means quick.
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"intakeProfile":"instant"}')$$,'%INVALID_INPUT%','unknown profiles are refused');
-- Explicit opt-in: this fixture exercises agreement enforcement.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"agreementRequiredFor":["review_publication","acceptance"]}'::jsonb);
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
-- No agreement evidence yet: the policy requires it for publication and acceptance.
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Blue jacket"}','25000')$$,'%AGREEMENT_REQUIRED%','the agreement rule still applies');
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.other')::uuid,0,'{"description":"Blue jacket"}','25000')$$,'%RECEPTION_SESSION_SELLER%','the session must belong to the named seller');
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Blue jacket","weight":"1"}','25000')$$,'%ATTRIBUTE_UNDEFINED%','an attribute nobody defined is refused, and says so');
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"   "}','25000')$$,'%INVALID_INPUT%','a description is required');
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,3,'{"description":"Blue jacket"}','25000')$$,'%RECEPTION_CHANGED%','the expected source revision must match');
select set_config('test.result',quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Blue jacket","category":"Jackets","brand":"","size":"M"}','25000')::text,true);
select matches(current_setting('test.result')::jsonb->>'reference','^I-[0-9A-F]{8}$','an item with a reference');
select matches(current_setting('test.result')::jsonb->>'itemId','^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$','the derived item id is RFC 4122 shaped');
select matches(current_setting('test.result')::jsonb->>'garmentId','^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$','the derived garment id is RFC 4122 shaped');
select is((current_setting('test.result')::jsonb->>'reviewVersion')::int,1,'one review published');
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'one item');
select is((select origin_kind from items where id=(current_setting('test.result')::jsonb->>'itemId')::uuid),'reception_review','the item comes from the reception review');
select is((select seller_id::text from items where id=(current_setting('test.result')::jsonb->>'itemId')::uuid),current_setting('test.seller'),'the item belongs to the seller');
select is((select price_ore from item_prices where item_id=(current_setting('test.result')::jsonb->>'itemId')::uuid),25000::bigint,'accepted price');
select is((select terms->>'evidenceKind' from items where id=(current_setting('test.result')::jsonb->>'itemId')::uuid),'staff_recorded','the signed agreement is the evidence');
select is((select count(*) from garment_receipts where session_id=current_setting('test.session')::uuid),1::bigint,'custody recorded');
select is((select revision from reception_source_revisions where session_id=current_setting('test.session')::uuid order by revision desc limit 1),1,'one source revision with the staff price evidence');
select is((select a->>'value' from reception_reviews r, jsonb_array_elements(r.suggestions->'attributes') a where r.session_id=current_setting('test.session')::uuid and a->>'slug'='description'),'Blue jacket','description published');
select ok((select not exists(select 1 from jsonb_array_elements(r.suggestions->'attributes') a where a->>'slug'='brand') from reception_reviews r where r.session_id=current_setting('test.session')::uuid),'blank facts are left out');
select is((select suggestions->'price'->>'amount' from reception_reviews where session_id=current_setting('test.session')::uuid),'250.00','price published in major units');
-- Replay: the same request again returns the same item and changes nothing.
select is(quick_receive(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Blue jacket","category":"Jackets","brand":"","size":"M"}','25000')->>'itemId',current_setting('test.result')::jsonb->>'itemId','replay returns the item');
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'still one item');
select is((select count(*) from reception_reviews where session_id=current_setting('test.session')::uuid),1::bigint,'still one review');
-- A second garment for the same seller with a photo saved first.
select set_config('test.session2',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.photo',gen_random_uuid()::text,true);
select set_config('test.path',current_setting('test.tenant')||'/'||current_setting('test.session2')||'/'||current_setting('test.photo')||'.jpg',true);
reset role;
insert into storage.objects(bucket_id,name) values('reception-photos',current_setting('test.path'));
set local role authenticated;
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,0,jsonb_build_array(jsonb_build_object('id',current_setting('test.photo'),'kind','photo','reference',current_setting('test.path'),'observation','')));
select set_config('test.result2',quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,current_setting('test.seller')::uuid,1,'{"description":"Red coat"}','40000')::text,true);
select is((select a->'sourceIds'->>0 from reception_reviews r, jsonb_array_elements(r.suggestions->'attributes') a where r.session_id=current_setting('test.session2')::uuid and a->>'slug'='description'),current_setting('test.photo'),'facts cite the photo when there is one');
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'two items');
-- The full profile keeps the step-by-step reception.
-- Quick reception is no longer limited to seven fields. A lamp records its
-- socket and its height through the same call, because the store's vocabulary
-- defines them, and the stored review keeps them where the seven fixed keys
-- have no room.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000981","role":"authenticated"}';
select set_config('test.lampsession',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.lampsession')::uuid,current_setting('test.seller')::uuid);
select lives_ok($$select quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.lampsession')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Brass table lamp","socket":"e27","height_cm":"45"}','25000','lamp')$$,'a lamp is received with attributes no garment has');
select is((select suggestions->>'itemType' from reception_reviews where tenant_id=current_setting('test.tenant')::uuid and session_id=current_setting('test.lampsession')::uuid),'lamp','the item type is recorded');
select is((select a->>'value' from reception_reviews r, jsonb_array_elements(r.suggestions->'attributes') a where r.session_id=current_setting('test.lampsession')::uuid and a->>'slug'='socket'),'e27','the socket is kept');
select ok((select not (suggestions ? 'metadata') from reception_reviews where session_id=current_setting('test.lampsession')::uuid),'and nothing is written under the retired fixed keys');

select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"intakeProfile":"full"}');
select set_config('test.session3',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session3')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Hat"}','5000')$$,'%INTAKE_PROFILE_FULL%','the full profile refuses quick reception');
-- Per-item seller approval still binds.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"intakeProfile":"quick","sellerReviewMode":"per_item"}');
select throws_like($$select quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session3')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Hat"}','5000')$$,'%SELLER_APPROVAL_REQUIRED%','per-item approval is not bypassed');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000982','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000982","role":"authenticated"}';
select throws_ok($$select quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session3')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Hat"}','5000')$$,'42501',null,'readonly members cannot receive');

select * from finish();
rollback;
