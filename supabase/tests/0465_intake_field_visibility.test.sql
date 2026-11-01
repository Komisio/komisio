begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4650000-0000-4000-8000-000000000001','visibility-owner@example.test',now()),
 ('f4650000-0000-4000-8000-000000000002','visibility-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4650000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Visibility test','visibility-737',gen_random_uuid()) as tenant \gset
select create_tenant('Other visibility test','visibility-other-737',gen_random_uuid()) as other \gset
select is(coalesce(registration_settings(:'tenant')->'settings'->'hiddenFields','[]'), '[]'::jsonb, 'new stores hide no fields');
select gen_random_uuid() as legacy \gset
select publish_registration_settings(:'tenant',:'legacy',null,'{"descriptionRequired":false,"titleTemplate":"{type}","attributes":["brand"]}');
select lives_ok(format('select publish_registration_settings(%L,%L,null,%L)',:'tenant',:'legacy','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":["brand"]}'),'legacy payload replays unchanged');
select is(coalesce(registration_settings(:'tenant')->'settings'->'hiddenFields','[]'),'[]'::jsonb,'existing settings hide no fields');
select gen_random_uuid() as version \gset
select publish_registration_settings(:'tenant',:'version',:'legacy','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":["brand"],"hiddenFields":["description","internalNote","photo","assortment","itemType","category","brand","size","color","condition","material"]}');
select is(jsonb_array_length(registration_settings(:'tenant')->'settings'->'hiddenFields'),11,'all optional fields persisted');
select is(jsonb_array_length(attribute_vocabulary(:'tenant')->'registration'->'settings'->'hiddenFields'),11,'intake vocabulary carries visibility');
select is(coalesce(registration_settings(:'other')->'settings'->'hiddenFields','[]'),'[]'::jsonb,'another store is unchanged');
select lives_ok(format('select publish_registration_settings(%L,%L,%L,%L)',:'tenant',:'version',:'legacy',(registration_settings(:'tenant')->'settings')::text),'visibility save replays');
select throws_like(format('select publish_registration_settings(%L,%L,%L,%L)',:'tenant',:'version',:'legacy','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":["brand"],"hiddenFields":[]}'),'%REQUEST_CONFLICT%','changed retry rejected');
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),%L,%L)',:'tenant',:'legacy','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":[]}'),'%REGISTRATION_CHANGED%','stale revision rejected');
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),%L,%L)',:'tenant',:'version',jsonb_build_object('descriptionRequired',false,'titleTemplate','{type}','attributes','[]'::jsonb,'hiddenFields',bad)::text),'%INVALID_INPUT%',label)
from (values ('["price"]'::jsonb,'price cannot be hidden'), ('["unknown"]','unknown fields rejected'), ('["photo","photo"]','duplicates rejected'), ('[true]','non-string field rejected'), ('null','null rejected'), ('{}','object rejected'), ('"photo"','string rejected')) invalid(bad,label);
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),%L,%L)',:'tenant',:'version','{"descriptionRequired":true,"titleTemplate":"{type}","attributes":[],"hiddenFields":["description"]}'),'%INVALID_INPUT%','required description cannot be hidden');
select gen_random_uuid() as required \gset
select lives_ok(format('select publish_registration_settings(%L,%L,%L,%L)',:'tenant',:'required',:'version','{"descriptionRequired":true,"titleTemplate":"{type}","attributes":[],"hiddenFields":["photo"]}'),'required description with other hidden fields accepted');
reset role;
insert into public.tenant_members(tenant_id,user_id,role) values (:'tenant','f4650000-0000-4000-8000-000000000002','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4650000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(registration_settings(:'tenant')->'settings'->'hiddenFields','["photo"]'::jsonb,'staff can read effective settings');
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),%L,%L)',:'tenant',:'required','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":[]}'),'%FORBIDDEN%','staff cannot change settings');
select throws_like(format('select registration_settings(%L)',:'other'),'%FORBIDDEN%','other tenant settings denied');
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),null,%L)',:'other','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":[]}'),'%FORBIDDEN%','other tenant writes denied');
select * from finish();
rollback;
