begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000a01','vocab-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000a02','vocab-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000a03','vocab-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000a01","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Vocabulary store','vocab-test',gen_random_uuid())::text,true);
select create_invitation(current_setting('test.tenant')::uuid,'vocab-staff@example.test','staff',repeat('d',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000a02","role":"authenticated"}';
select accept_invitation(repeat('d',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000a01","role":"authenticated"}';

-- A brand new store already has a usable vocabulary: nobody administers
-- attributes before receiving their first lamp.
select ok(jsonb_array_length(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions')>=11,'the platform vocabulary is there from the start');
select is((select count(*) from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug' in ('sweater','lamp')),2::bigint,'sweater and lamp are seeded');
-- A type asks its own questions: a lamp is not a garment.
select set_config('test.lamp',(select t->'attributes' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='lamp')::text,true);
select set_config('test.sweater',(select t->'attributes' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='sweater')::text,true);
select ok(current_setting('test.lamp')::jsonb @> '[{"slug":"socket"}]','a lamp asks for its socket');
select ok(not (current_setting('test.lamp')::jsonb @> '[{"slug":"size"}]'),'and not for a garment size');
select ok(current_setting('test.sweater')::jsonb @> '[{"slug":"size"}]','a sweater asks for its size');
select ok(not (current_setting('test.sweater')::jsonb @> '[{"slug":"socket"}]'),'and not for a socket');
-- A choice carries stable value ids, so navy is one colour and not three.
select is((select d->>'data_type' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='socket'),'choice','the socket is a choice');
select ok((select d->'choices' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='socket') @> '[{"id":"e27"}]','and its values have stable ids');
select is((select d->>'unit' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='max_wattage'),'W','a number carries its unit on the definition');

-- The store adds its own attribute.
select is(set_attribute_definition(current_setting('test.tenant')::uuid,'impedance','{"dataType":"number","unit":"ohm","labels":{"sv":"Impedans","en":"Impedance"}}')->>'version','1','a store defines its own attribute');
select is((select d->>'own' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='impedance'),'true','and it is marked as the store''s own');

-- Presentation changes in place; meaning creates a version.
select is(set_attribute_definition(current_setting('test.tenant')::uuid,'impedance','{"dataType":"number","unit":"ohm","labels":{"sv":"Impedans (ohm)","en":"Impedance"}}')->>'version','1','a new label does not make a new version');
select is((select d->'labels'->>'sv' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='impedance'),'Impedans (ohm)','and the new label is what the form shows');
select is(set_attribute_definition(current_setting('test.tenant')::uuid,'impedance','{"dataType":"text","labels":{"sv":"Impedans (ohm)","en":"Impedance"}}')->>'version','2','a changed data type makes a new version');
select is((select count(*) from attribute_definitions where tenant_id=current_setting('test.tenant')::uuid and slug='impedance'),2::bigint,'and the old version is still there');
-- An observation recorded under version 1 must still be able to find what it meant.
select is((select unit from attribute_definitions where tenant_id=current_setting('test.tenant')::uuid and slug='impedance' and version=1),'ohm','version 1 keeps its unit');

-- A store shadows a platform attribute without inventing a second name.
select set_attribute_definition(current_setting('test.tenant')::uuid,'color','{"dataType":"choice","choices":[{"id":"navy","labels":{"sv":"Marinblå","en":"Navy"}},{"id":"black","labels":{"sv":"Svart","en":"Black"}}],"labels":{"sv":"Färg","en":"Colour"}}');
select is((select count(*) from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='color'),1::bigint,'one colour, not two');
select is((select d->>'data_type' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions') d where d->>'slug'='color'),'choice','and the store''s definition wins over the platform''s');

-- The store adds a type of its own.
select is(set_item_type(current_setting('test.tenant')::uuid,'vinyl_record','{"labels":{"sv":"Vinylskiva","en":"Vinyl record"},"suggestedCategory":"Musik","attributes":[{"slug":"description","expected":true,"sort":1},{"slug":"condition","expected":true,"sort":2}]}')->>'attributes','2','a store defines its own type with a profile');
select is((select t->>'suggested_category' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='vinyl_record'),'Musik','the type suggests a category without replacing it');
-- Saving a profile again replaces it wholesale, which is what an editor does.
select is(set_item_type(current_setting('test.tenant')::uuid,'vinyl_record','{"labels":{"sv":"Vinylskiva","en":"Vinyl record"},"attributes":[{"slug":"description","expected":true,"sort":1}]}')->>'attributes','1','saving a profile replaces it');
select is((select jsonb_array_length(t->'attributes') from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='vinyl_record'),1,'and the removed attribute is gone');

-- Refusals.
select throws_like($$select set_attribute_definition(current_setting('test.tenant')::uuid,'Färg','{"dataType":"text","labels":{"sv":"Färg"}}')$$,'%INVALID_INPUT%','a slug is never a translated word');
select throws_like($$select set_attribute_definition(current_setting('test.tenant')::uuid,'weight','{"dataType":"number","unit":"kg","labels":{"pt":"Peso"}}')$$,'%INVALID_INPUT%','a label in an unsupported language is refused');
select throws_like($$select set_attribute_definition(current_setting('test.tenant')::uuid,'weight','{"dataType":"choice","labels":{"en":"Weight"}}')$$,'%INVALID_INPUT%','a choice with no values is refused');
select throws_like($$select set_attribute_definition(current_setting('test.tenant')::uuid,'weight','{"dataType":"text","unit":"kg","labels":{"en":"Weight"}}')$$,'%INVALID_INPUT%','a unit on something that is not a number is refused');
select throws_like($$select set_attribute_definition(current_setting('test.tenant')::uuid,'socket_kind','{"dataType":"choice","choices":[{"id":"e27","labels":{"en":"E27"}},{"id":"e27","labels":{"en":"E27 again"}}],"labels":{"en":"Socket"}}')$$,'%INVALID_INPUT%','two values with the same id are refused');

-- Only an owner or admin owns the vocabulary; staff read it.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000a02","role":"authenticated"}';
select ok(jsonb_array_length(attribute_vocabulary(current_setting('test.tenant')::uuid)->'definitions')>0,'staff read the vocabulary');
select throws_ok($$select set_attribute_definition(current_setting('test.tenant')::uuid,'staff_idea','{"dataType":"text","labels":{"en":"Idea"}}')$$,'42501',null,'staff cannot define one');
select throws_ok($$select set_item_type(current_setting('test.tenant')::uuid,'staff_type','{"labels":{"en":"Type"}}')$$,'42501',null,'and cannot define a type');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000a03","role":"authenticated"}';
select throws_ok($$select attribute_vocabulary(current_setting('test.tenant')::uuid)$$,'42501',null,'an outsider reads nothing');

-- Nobody writes these tables directly, and the platform vocabulary is nobody's
-- to edit.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000a01","role":"authenticated"}';
select throws_ok($$insert into attribute_definitions(tenant_id,slug,version,data_type,labels) values(current_setting('test.tenant')::uuid,'sneaky',1,'text','{"en":"Sneaky"}')$$,'42501',null,'a direct insert is refused');
select throws_ok($$update attribute_definitions set active=false where tenant_id is null and slug='color'$$,'42501',null,'the platform vocabulary is not editable by a store');
select * from finish();
rollback;
