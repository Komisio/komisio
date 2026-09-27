begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- After 20260927210000 the platform socket exists as version 1 (sv/en choice
-- labels, now with eight-language definition labels) and version 2 (choice
-- labels in eight languages). This file proves what that means for bindings
-- and for the seller: a new quick reception binds to the platform's newest
-- version, a store's own socket keeps binding to its own version, a
-- historical version-1 observation reads back unchanged, and a seller under a
-- German agreement sees the German label with the same stored value.
-- Everything runs through the engine's own commands; no trigger is touched.
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000c01','bind-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000c02','bind-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000000c03','bind-other-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000c04','bind-other-seller@example.test',now());

-- Store A uses the platform vocabulary and speaks German to its sellers.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c01","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Binding store','binding-store',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','bind-seller@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Bedingungen','Nur ein Test','de',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin","vatRatePercent":25}');

-- The platform socket as this store sees it: version 2 with eight choice languages, version 1 still present.
select is((select d->>'version' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='socket'),'2','the store sees the platform socket at version 2');
select is((select d->>'own' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='socket'),'false','and it is the platform''s, not the store''s');
select is((select count(*) from attribute_definitions where tenant_id is null and slug='socket'),2::bigint,'platform version 1 is kept beside version 2');
select is((select c->'labels'->>'de' from attribute_definitions d cross join lateral jsonb_array_elements(d.choices) c where d.tenant_id is null and d.slug='socket' and d.version=2 and c->>'id'='integrated'),'Integrierte LED','version 2 carries German choice labels');
select is((select array_agg(c->>'id' order by o) from attribute_definitions d cross join lateral jsonb_array_elements(d.choices) with ordinality c(c,o) where d.tenant_id is null and d.slug='socket' and d.version=2),(select array_agg(c->>'id' order by o) from attribute_definitions d cross join lateral jsonb_array_elements(d.choices) with ordinality c(c,o) where d.tenant_id is null and d.slug='socket' and d.version=1),'version 2 keeps version 1''s choice ids in the same order');

-- 1. A new quick reception binds the socket to the platform's newest version.
select set_config('test.quick',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.quick')::uuid,current_setting('test.seller')::uuid);
select set_config('test.quick_result',quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.quick')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Brass lamp","socket":"e27"}',25000,'lamp')::text,true);
select set_config('test.quick_item',current_setting('test.quick_result')::jsonb->>'itemId',true);
select is((select a->>'definitionVersion' from reception_reviews r cross join lateral jsonb_array_elements(r.suggestions->'attributes') a where r.session_id=current_setting('test.quick')::uuid and a->>'slug'='socket'),'2','a new quick reception binds the socket to platform version 2');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.quick_item')::uuid)) a where a->>'slug'='socket'),'e27','and the accepted item reads the chosen id');
select is((select a->>'definitionVersion' from reception_reviews r cross join lateral jsonb_array_elements(r.suggestions->'attributes') a where r.session_id=current_setting('test.quick')::uuid and a->>'slug'='description'),'1','a text attribute without a new version still binds to version 1');

-- 2. A historical version-1 observation stays readable with the same value.
select set_config('test.session',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid);
select set_config('test.src',gen_random_uuid()::text,true);
select set_config('test.pe',gen_random_uuid()::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 jsonb_build_array(
  jsonb_build_object('id',current_setting('test.src'),'kind','observation','reference','TEST staff note','observation','Old brass lamp, E27'),
  jsonb_build_object('id',current_setting('test.pe'),'kind','price-evidence','reference','TEST comparable sales','observation','Similar lamps sold at 250')));
select set_config('test.review',gen_random_uuid()::text,true);
select set_config('test.suggestions',jsonb_build_object(
 'itemType','lamp',
 'attributes',jsonb_build_array(
   jsonb_build_object('slug','description','definitionVersion',1,'value','Old brass lamp','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed'),
   jsonb_build_object('slug','socket','definitionVersion',1,'value','e27','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed')),
 'price',jsonb_build_object('currency','SEK','amount','250.00','rationale','Comparable lamps','sourceIds',jsonb_build_array(current_setting('test.pe'))),
 'questions','[]'::jsonb)::text,true);
select lives_ok($$select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day')$$,'a review bound to socket version 1 is still publishable while version 1 exists');
select set_config('test.item',gen_random_uuid()::text,true);
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'');
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'reception_review',current_setting('test.session')::uuid,1,25000);
select is((select a->>'definitionVersion' from reception_reviews r cross join lateral jsonb_array_elements(r.suggestions->'attributes') a where r.id=current_setting('test.review')::uuid and a->>'slug'='socket'),'1','the historical observation keeps its version 1 binding');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='socket'),'e27','and reads back the same value after version 2 exists');
select is((select c->'labels'->>'sv' from attribute_definitions d cross join lateral jsonb_array_elements(d.choices) c where d.tenant_id is null and d.slug='socket' and d.version=1 and c->>'id'='e27'),'E27','version 1''s choices are untouched');

-- 3. The seller reads the German label with the same stored value.
select set_config('test.token',repeat('e',64),true);
select set_reception_access(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.review')::uuid,null,encode(sha256(convert_to(current_setting('test.token'),'UTF8')),'hex'));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c02","role":"authenticated"}';
select set_config('test.seen',read_seller_review(current_setting('test.token'))::text,true);
select is((select f->>'label' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f where f->>'slug'='socket'),'Fassung','under a German agreement the seller reads the German label');
select is((select f->>'value' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f where f->>'slug'='socket'),'e27','with the same stored value');
select is((select f->>'label' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f where f->>'slug'='description'),'Beschreibung','a text attribute is labelled in German too');

-- 4. Store B overrides the socket: its own definition keeps binding to its own version.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c03","role":"authenticated"}';
select set_config('test.tenant_b',create_tenant('Override store','override-store',gen_random_uuid())::text,true);
select set_config('test.seller_b',register_seller(current_setting('test.tenant_b')::uuid,gen_random_uuid(),'Other seller','bind-other-seller@example.test','')::text,true);
select publish_store_policy(current_setting('test.tenant_b')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant_b')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin","vatRatePercent":25}');
select is(set_attribute_definition(current_setting('test.tenant_b')::uuid,'socket','{"dataType":"choice","choices":[{"id":"e27","labels":{"sv":"E27","en":"E27"}},{"id":"bayonet","labels":{"sv":"Bajonett","en":"Bayonet"}}],"labels":{"sv":"Sockel","en":"Socket"}}')->>'version','1','the store''s own socket is its version 1');
select is((select d->>'own' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant_b')::uuid)->'definitions') d where d->>'slug'='socket'),'true','and it is what the store sees');
select is((select d->>'version' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant_b')::uuid)->'definitions') d where d->>'slug'='socket'),'1','at its own version, not the platform''s 2');
select set_config('test.quick_b',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant_b')::uuid,current_setting('test.quick_b')::uuid,current_setting('test.seller_b')::uuid);
select quick_receive(current_setting('test.tenant_b')::uuid,gen_random_uuid(),current_setting('test.quick_b')::uuid,current_setting('test.seller_b')::uuid,0,'{"description":"Bayonet lamp","socket":"bayonet"}',20000,'lamp');
select is((select a->>'definitionVersion' from reception_reviews r cross join lateral jsonb_array_elements(r.suggestions->'attributes') a where r.session_id=current_setting('test.quick_b')::uuid and a->>'slug'='socket'),'1','a reception in the overriding store binds to the store''s own version 1');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant_b')::uuid,(select id from items where tenant_id=current_setting('test.tenant_b')::uuid limit 1))) a where a->>'slug'='socket'),'bayonet','with a choice id only the store''s definition has');
-- Store A is unaffected by store B's override.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c01","role":"authenticated"}';
select is((select d->>'version' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='socket'),'2','the first store still sees platform version 2');
select ok(not exists(select 1 from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d cross join lateral jsonb_array_elements(d->'choices') c where d->>'slug'='socket' and c->>'id'='bayonet'),'and none of the other store''s choices');
reset role;
select * from finish();
rollback;
