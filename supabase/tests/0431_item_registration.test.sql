begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4310000-0000-4000-8000-000000000001','registration-owner@example.test',now()),
 ('f4310000-0000-4000-8000-000000000002','registration-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4310000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Registration test','registration-653',gen_random_uuid()) as tenant \gset
select set_config('test.tenant',:'tenant',true);
select is(registration_settings(:'tenant')->'settings'->>'descriptionRequired','false','description optional by default');
select gen_random_uuid() as settings \gset
select publish_registration_settings(:'tenant',:'settings',null,'{"descriptionRequired":false,"titleTemplate":"{type} {brand} {size}","attributes":["brand","size"]}');
select lives_ok(format('select publish_registration_settings(%L,%L,null,%L)',:'tenant',:'settings','{"descriptionRequired":false,"titleTemplate":"{type} {brand} {size}","attributes":["brand","size"]}'),'settings retry idempotent');
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),null,%L)',:'tenant','{"descriptionRequired":false,"titleTemplate":"{type}","attributes":[]}'),'%REGISTRATION_CHANGED%','stale settings refused');
select throws_like(format('select publish_registration_settings(%L,gen_random_uuid(),%L,%L)',:'tenant',:'settings','{"descriptionRequired":false,"titleTemplate":"{secret}","attributes":[]}'),'%INVALID_INPUT%','unknown template token rejected');
select ok(not exists(select 1 from jsonb_array_elements(attribute_vocabulary(:'tenant')->'types') t where not (t->>'own')::boolean and t->'attributes' @> '[{"slug":"dimmable"}]'),'starter types inherit store fields');
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','registration-seller@example.test','') as seller \gset
select publish_seller_agreement(:'tenant',gen_random_uuid(),null,'Synthetic terms','Test','en',false) as agreement \gset
select record_agreement_evidence(:'tenant',gen_random_uuid(),:'seller',:'agreement','Signed');
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy')||'{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select create_reception_session(:'tenant',gen_random_uuid(),:'seller') as session \gset
select gen_random_uuid() as request \gset
select quick_receive_noted(:'tenant',:'request',:'session',:'seller',0,'{"brand":"Synthetic","size":"M"}',20000,null,null,null,null,'PRIVATE sleeve stain') as result \gset
select :'result'::jsonb->>'itemId' as item \gset
select is(item_internal_note(:'tenant','item',:'item')->>'note','PRIVATE sleeve stain','staff can read registration note');
select is(item_label_facts(:'tenant',:'item')->>'title','Synthetic M','generated title reaches labels');
select ok(item_label_facts(:'tenant',:'item')::text not like '%PRIVATE%','labels exclude note');
select publish_zettle_catalog_config(:'tenant',gen_random_uuid(),null,'{"consignment_margin":0,"store_full":25}');
select prepare_zettle_product(:'tenant',:'item') as export \gset
select is((select payload->>'name' from zettle_product_exports where id=:'export'),'Synthetic M','POS snapshot uses generated title');
select ok((select payload::text not like '%PRIVATE%' from zettle_product_exports where id=:'export'),'POS snapshot excludes private note');
select jsonb_build_array(jsonb_build_object('reference','OPTIONAL-DESCRIPTION','sellerId',:'seller','email','','description','','priceOre',10000,'currency','SEK')) as import_rows \gset
select lives_ok(format('select import_inventory(%L,gen_random_uuid(),''synthetic.csv'',%L,inventory_import_context(%L,array[%L::uuid]),true)',:'tenant',:'import_rows',:'tenant',:'seller'),'inventory import accepts an empty description');
select lives_ok(format('select quick_receive_noted(%L,%L,%L,%L,0,%L,20000,null,null,null,null,%L)',:'tenant',:'request',:'session',:'seller','{"brand":"Synthetic","size":"M"}','PRIVATE sleeve stain'),'registration with note replays once');
select throws_like(format('select quick_receive_noted(%L,%L,%L,%L,0,%L,20000,null,null,null,null,%L)',:'tenant',:'request',:'session',:'seller','{"brand":"Synthetic","size":"M"}','different note'),'%REQUEST_CONFLICT%','note cannot change on a registration replay');
select gen_random_uuid() as type_request \gset
select create_inheriting_item_type(:'tenant',:'type_request','Synthetic Type','en') as type \gset
select lives_ok(format('select create_inheriting_item_type(%L,%L,%L,''en'')',:'tenant',:'type_request','Synthetic Type'),'new inheriting type replays');
select is((select t->'attributes'->0->>'slug' from jsonb_array_elements(attribute_vocabulary(:'tenant')->'types') t where t->>'slug'=:'type'),'brand','new type inherits existing store default');
select set_item_type(:'tenant','custom_override','{"labels":{"en":"Custom fields"},"attributes":[{"slug":"material","expected":false,"sort":0}],"inheritAttributes":false}');
select gen_random_uuid() as empty_settings \gset
select publish_registration_settings(:'tenant',:'empty_settings',:'settings','{"descriptionRequired":false,"titleTemplate":"{brand} {size}","attributes":[]}');
select is((select t->'attributes' from jsonb_array_elements(attribute_vocabulary(:'tenant')->'types') t where t->>'slug'=:'type'),'[]'::jsonb,'already created inheriting type follows changed empty defaults');
select is((select t->'attributes'->0->>'slug' from jsonb_array_elements(attribute_vocabulary(:'tenant')->'types') t where t->>'slug'='custom_override'),'material','explicit override survives default change');
select set_item_type(:'tenant','custom_override','{"labels":{"en":"Custom fields"},"attributes":[],"inheritAttributes":false}');
select is((select t->'attributes' from jsonb_array_elements(attribute_vocabulary(:'tenant')->'types') t where t->>'slug'='custom_override'),'[]'::jsonb,'explicit empty override remains empty');
select gen_random_uuid() as purchase \gset
select register_purchase_described(:'tenant',:'purchase','',10000,'Synthetic receipt',false,'{"brand":"Purchase Brand","size":"L"}',:'type','PRIVATE purchase defect');
select accept_item(:'tenant',gen_random_uuid(),'purchase',:'purchase',null,20000) as purchased_item \gset
select is(item_label_facts(:'tenant',:'purchased_item')->>'title','Purchase Brand L','own stock has generated title from registration facts');
select is(item_internal_note(:'tenant','item',:'purchased_item')->>'note','PRIVATE purchase defect','purchase note follows accepted item separately');
select lives_ok(format('select register_purchase_described(%L,%L,'''',10000,''Synthetic receipt'',false,%L,%L,%L)',:'tenant',:'purchase','{"brand":"Purchase Brand","size":"L"}',:'type','PRIVATE purchase defect'),'purchase replay does not duplicate note');
select gen_random_uuid() as required_settings \gset
select publish_registration_settings(:'tenant',:'required_settings',:'empty_settings','{"descriptionRequired":true,"titleTemplate":"{brand} {size}","attributes":["size"]}');
select create_reception_session(:'tenant',gen_random_uuid(),:'seller') as required_session \gset
select throws_like(format('select quick_receive(%L,gen_random_uuid(),%L,%L,0,%L,20000,null)',:'tenant',:'required_session',:'seller','{}'),'%DESCRIPTION_REQUIRED%','store requirement enforced without a type');
select throws_like(format('select quick_receive(%L,gen_random_uuid(),%L,%L,0,%L,20000,%L)',:'tenant',:'required_session',:'seller','{}',:'type'),'%DESCRIPTION_REQUIRED%','same requirement with inheriting type');
select throws_like(format('select quick_receive(%L,gen_random_uuid(),%L,%L,0,%L,20000,''custom_override'')',:'tenant',:'required_session',:'seller','{}'),'%DESCRIPTION_REQUIRED%','same requirement with explicit empty type override');
select throws_like(format('select register_purchase(%L,gen_random_uuid(),'''',10000,''Receipt'',false)',:'tenant'),'%DESCRIPTION_REQUIRED%','own stock enforces store requirement');
select throws_like(format('select import_inventory(%L,gen_random_uuid(),''synthetic.csv'',%L,inventory_import_context(%L,array[%L::uuid]),true)',:'tenant',jsonb_set(:'import_rows'::jsonb,'{0,reference}','"REQUIRED-DESCRIPTION"'),:'tenant',:'seller'),'%DESCRIPTION_REQUIRED%','inventory import enforces store requirement');
select lives_ok(format('select quick_receive_noted(%L,%L,%L,%L,0,%L,20000,null,null,null,null,%L)',:'tenant',:'request',:'session',:'seller','{"brand":"Synthetic","size":"M"}','PRIVATE sleeve stain'),'replay of accepted optional description survives later policy change');
select gen_random_uuid() as note_edit \gset
select item_internal_note(:'tenant','item',:'item')->>'id' as note_previous \gset
select save_item_internal_note(:'tenant',:'note_edit','item',:'item',:'note_previous','Updated PRIVATE note');
select throws_like(format('select save_item_internal_note(%L,gen_random_uuid(),''item'',%L,%L,''Stale overwrite'')',:'tenant',:'item',:'note_previous'),'%NOTE_CHANGED%','stale note edit cannot overwrite colleague');
select throws_ok(format('insert into item_internal_notes(id,tenant_id,subject_kind,subject_id,version,note,created_by) values(gen_random_uuid(),%L,''item'',%L,99,''Direct'',auth.uid())',:'tenant',:'item'),'42501',null,'direct note writes denied');
reset role;
select is(komisio_private.render_registration_title('{brand} {size}','{"brand":"Literal {size}","size":"M"}'),'Literal {size} M','braces inside observed values are literal, not template code');
select is(komisio_private.render_registration_title('{type} {brand} {size}','{}'),'','missing values produce an empty fallback candidate');
select is(length(komisio_private.render_registration_title('{brand} {size}',jsonb_build_object('brand',repeat('a',1000),'size','M'))),1000,'generated titles keep the existing description size bound');
select ok(not has_function_privilege('anon','public.item_internal_note(uuid,text,uuid)','execute'),'anonymous callers cannot invoke note reads');
select is(komisio_private.item_title(:'tenant',:'item')->>'title','Synthetic M','missing template values collapse cleanly');
select ok(komisio_private.item_attributes(:'tenant',:'item')::text not like '%PRIVATE%','notes excluded from attributes');
select ok((select sources::text not like '%PRIVATE%' from reception_source_revisions where session_id=:'session' order by revision desc limit 1),'notes excluded from seller-visible sources');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4310000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(format('select item_internal_note(%L,''item'',%L)',:'tenant',:'item'),'42501',null,'seller cannot read notes');
select is((select count(*) from item_internal_notes),0::bigint,'RLS hides note rows from seller');
select ok(my_items_page(:'tenant',:'seller','Synthetic M',0)::text like '%Synthetic M%','seller can search generated titles through existing authorized projection');
select ok(my_items_page(:'tenant',:'seller','',0)::text not like '%PRIVATE%','seller item payload excludes internal notes');
select throws_ok(format('select registration_settings(%L)',:'tenant'),'42501',null,'seller cannot inspect staff registration settings');
select throws_ok(format('select save_item_internal_note(%L,gen_random_uuid(),''item'',%L,null,''Seller write'')',:'tenant',:'item'),'42501',null,'seller cannot write notes');
select * from finish();
rollback;
