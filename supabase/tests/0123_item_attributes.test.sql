begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000b01','attrs-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000b02','attrs-outsider@example.test',now()),
 ('f0000000-0000-4000-8000-000000000b03','seller@attrs.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000b01","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Attribute store','attrs-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','seller@attrs.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin","vatRatePercent":25}');

-- A lamp: a reception that carries attributes no garment has.
select set_config('test.session',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid);
select set_config('test.src',gen_random_uuid()::text,true);
select set_config('test.pe',gen_random_uuid()::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 jsonb_build_array(
  jsonb_build_object('id',current_setting('test.src'),'kind','observation','reference','TEST staff note','observation','Brass table lamp, E27, 45 cm'),
  jsonb_build_object('id',current_setting('test.pe'),'kind','price-evidence','reference','TEST comparable sales','observation','Similar lamps sold at 250')));
select set_config('test.review',gen_random_uuid()::text,true);
select set_config('test.suggestions',jsonb_build_object(
 'itemType','lamp',
 'attributes',jsonb_build_array(
   jsonb_build_object('slug','description','definitionVersion',1,'value','Brass table lamp','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed'),
   jsonb_build_object('slug','category','definitionVersion',1,'value','Belysning','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed'),
   jsonb_build_object('slug','socket','definitionVersion',1,'value','e27','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed'),
   jsonb_build_object('slug','height_cm','definitionVersion',1,'value','45','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed')),
 'price',jsonb_build_object('currency','SEK','amount','250.00','rationale','Comparable lamps','sourceIds',jsonb_build_array(current_setting('test.pe'))),
 'questions','[]'::jsonb)::text,true);
select lives_ok($$select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day')$$,'a lamp is published with attributes no garment has');

-- The list is the only description a review carries.
select set_config('test.stored',(select suggestions from reception_reviews where id=current_setting('test.review')::uuid)::text,true);
select is(jsonb_array_length(current_setting('test.stored')::jsonb->'attributes'),4,'all four attributes are stored');
select ok(not (current_setting('test.stored')::jsonb ? 'metadata'),'and nothing is stored under the retired fixed keys');
select is(current_setting('test.stored')::jsonb->>'itemType','lamp','the item type is stored');
-- The socket survives where the old shape would have dropped it.
select is((select a->>'value' from jsonb_array_elements(current_setting('test.stored')::jsonb->'attributes') a where a->>'slug'='socket'),'e27','the socket is kept, which the seven fixed keys could not do');

-- A caller that sends the retired fixed keys and no list has described
-- nothing, and is refused rather than quietly storing an empty review.
select set_config('test.session2',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.session2')::uuid,current_setting('test.seller')::uuid);
select set_config('test.src2',gen_random_uuid()::text,true);
select set_config('test.pe2',gen_random_uuid()::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,0,
 jsonb_build_array(
  jsonb_build_object('id',current_setting('test.src2'),'kind','observation','reference','TEST staff note','observation','Blue wool sweater'),
  jsonb_build_object('id',current_setting('test.pe2'),'kind','price-evidence','reference','TEST comparable sales','observation','Similar sweaters sold at 200')));
select set_config('test.review2',gen_random_uuid()::text,true);
select set_config('test.legacy',jsonb_build_object(
  'metadata',jsonb_build_object(
    'description',jsonb_build_object('value','Blue wool sweater','sourceIds',jsonb_build_array(current_setting('test.src2')),'certainty','observed')),
  'price',jsonb_build_object('currency','SEK','amount','200.00','rationale','Comparable sweaters','sourceIds',jsonb_build_array(current_setting('test.pe2'))),
  'questions','[]'::jsonb)::text,true);
select throws_like($$select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review2')::uuid,current_setting('test.session2')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.legacy')::jsonb,now()+interval '1 day')$$,'%INVALID_INPUT%','a review without an attribute list is refused');

-- A replay of the same call is still the same call, not a conflict, even
-- though what is stored is not byte for byte what was sent.
select lives_ok($$select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day')$$,'a replay of a normalised call is not a conflict');

-- Nothing enters a published review that is not bound to a definition the
-- store can see, and no type that does not exist.
select set_config('test.undefined',(current_setting('test.suggestions')::jsonb || jsonb_build_object('attributes',
  jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value','x','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed'),
                    jsonb_build_object('slug','impedance','definitionVersion',1,'value','8','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed'))))::text,true);
select throws_like($$select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.review')::uuid,current_setting('test.agreement')::uuid,current_setting('test.undefined')::jsonb,now()+interval '1 day')$$,'%ATTRIBUTE_UNDEFINED%','an attribute nobody defined is refused');
select throws_like($$select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.review')::uuid,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb || '{"itemType":"spaceship"}',now()+interval '1 day')$$,'%ITEM_TYPE_UNDEFINED%','a type nobody defined is refused');
-- A guess is held for review before it is published, as the seven already are.
select throws_like($$select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,current_setting('test.review')::uuid,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb || jsonb_build_object('attributes',jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value','x','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','tentative'))),now()+interval '1 day')$$,'%INVALID_INPUT%','a tentative observation is not published');

-- The read seam: one call, whatever the item came from.
select set_config('test.item',gen_random_uuid()::text,true);
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'');
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'reception_review',current_setting('test.session')::uuid,1,25000);
select is(jsonb_array_length(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)),4,'an accepted lamp reads back its four attributes');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='height_cm'),'45','including the one the fixed shape had no room for');
-- An inspected item answers the same call with its three columns.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Red coat','Coats','Good');
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,30000);
select is(jsonb_array_length(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid)),3,'an inspected item answers the same call');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid)) a where a->>'slug'='condition'),'Good','with its own columns mapped onto the same slugs');
select is(item_attribute_list(current_setting('test.tenant')::uuid,gen_random_uuid()),null,'an unknown item is null, not an error');

-- The read belongs to a member of the store.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000b02","role":"authenticated"}';
select throws_ok($$select item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)$$,'42501',null,'an outsider reads nothing');
reset role;
select is((select scope from connector_functions where function_name='item_attribute_list'),'items:read','a connected assistant reaches the read under the items scope');
-- Back to the owner: the checks above reset the role.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000b01","role":"authenticated"}';
-- The person asked to approve the lamp sees everything that was recorded,
-- not the part that fitted seven fixed keys. Before this, a seller approved a
-- description while the socket and the height stayed inside the store.
select set_config('test.token',repeat('f',64),true);
select set_reception_access(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.review')::uuid,null,encode(sha256(convert_to(current_setting('test.token'),'UTF8')),'hex'));
-- The seller reads it as themselves: the token names the link and the signed-in
-- address must match the one the review was published to.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000b03","role":"authenticated"}';
select set_config('test.seen',read_seller_review(current_setting('test.token'))::text,true);
select is((select f->>'value' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f where f->>'slug'='socket'),'e27','the seller sees the socket');
select is((select f->>'value' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f where f->>'slug'='height_cm'),'45','and the height');
select is((select f->>'label' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f where f->>'slug'='socket'),'Socket','named in the language of the terms the seller is reading, not as a slug');
select is((select f->>'slug' from jsonb_array_elements(current_setting('test.seen')::jsonb->'facts') f limit 1),'description','and in the order it was recorded');

-- Recreate a pre-attribute immutable row inside this rolled-back fixture only.
-- Production migration never changes reviews or their write constraints.
reset role;
alter table public.reception_reviews drop constraint reception_reviews_suggestions_check;
alter table public.reception_reviews disable trigger reception_reviews_immutable;
update public.reception_reviews set suggestions=(suggestions-'attributes'-'itemType') ||
 jsonb_build_object('metadata',jsonb_build_object('description',jsonb_build_object(
 'value','Historical lamp','sourceIds',jsonb_build_array(current_setting('test.src')),'certainty','observed')))
 where id=current_setting('test.review')::uuid;
alter table public.reception_reviews enable trigger reception_reviews_immutable;
alter table public.reception_reviews add constraint reception_reviews_suggestions_check
 check(komisio_private.valid_reception_review(suggestions)) not valid;
select set_config('test.historical',(select suggestions from public.reception_reviews where id=current_setting('test.review')::uuid)::text,true);
select ok(not komisio_private.valid_reception_review(current_setting('test.historical')::jsonb),'historical shape still rejected for new writes');
select is(komisio_private.stored_review_attributes('{"attributes":[],"metadata":{"description":{"value":"stale"}}}'), '[]'::jsonb,'explicit empty list never revives metadata');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000b03","role":"authenticated"}';
select is(read_seller_review(current_setting('test.token'))->'metadata'->>'description','Historical lamp','seller still sees historical description');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000b01","role":"authenticated"}';
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='description'),'Historical lamp','accepted historical item keeps its description');
select is((select suggestions from public.reception_reviews where id=current_setting('test.review')::uuid),current_setting('test.historical')::jsonb,'reading never rewrites accepted evidence');
reset role;
select throws_like($$update public.reception_reviews set suggestions=suggestions where id=current_setting('test.review')::uuid$$,'%IMMUTABLE%','historical reviews remain immutable');

select * from finish();
rollback;
