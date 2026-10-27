begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000004331','owned-types@example.test',now()),
 ('f0000000-0000-4000-8000-000000004332','owned-types-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000004331","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Own types','own-types-433',gen_random_uuid())::text,true);
select is((select array_agg(t->>'slug' order by t->>'slug') from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t),array['jacket','trousers'],'new stores contain only their own two starters, including inactive rows');
select ok((select bool_and((t->>'own')::boolean) from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t),'every selectable type is store-owned');
select is((select count(*) from item_types where tenant_id is null),0::bigint,'RLS hides shared types');
select is((select count(*) from item_type_attributes where tenant_id is null),0::bigint,'RLS hides shared type profiles');
select ok(exists(select 1 from attribute_definitions where tenant_id is null and slug='brand'),'shared attribute library remains readable');
select lives_ok($$select create_inheriting_item_type(current_setting('test.tenant')::uuid,gen_random_uuid(),'Lamp','en')$$,'unused shared names do not block store creation');
select throws_ok($$select register_purchase_described(current_setting('test.tenant')::uuid,gen_random_uuid(),'A lamp',100,'Receipt',false,'{}','lamp','')$$,'P0001','ITEM_TYPE_UNDEFINED','new purchases cannot reference a hidden platform type');
select is(delete_catalogue_record(current_setting('test.tenant')::uuid,'type','trousers')->>'ok','true','unused store starters are deletable');
select is(delete_catalogue_record(current_setting('test.tenant')::uuid,'type','trousers')->>'ok','true','deletion is replay-safe');
select is((select count(*) from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='trousers'),0::bigint,'deleted types never fall back to platform definitions');
select ok((select not has_function_privilege('authenticated',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='komisio_private' and p.proname='copy_used_shared_item_types'),'copy operation is not exposed to users');
-- A legacy staged reference alone is enough to retain its shared type.
reset role;
insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
values('f0000000-0000-4000-8000-000000004333',current_setting('test.tenant')::uuid,'publishReceptionReview','medium','{"suggestions":{"itemType":"lamp"}}','agent','Synthetic legacy proposal','f0000000-0000-4000-8000-000000004331',now()+interval '1 day');
select set_config('test.proposal',(select to_jsonb(p)::text from pending_operations p where id='f0000000-0000-4000-8000-000000004333'),true);
select lives_ok($$select * from komisio_private.copy_used_shared_item_types()$$,'used shared type can be copied');
select is((select count(*) from item_types where tenant_id=current_setting('test.tenant')::uuid and slug='lamp'),1::bigint,'shared slug now resolves to exactly one own copy');
select is((select jsonb_build_object('labels',labels,'category',suggested_category,'active',active,'inherit',inherit_attributes) from item_types where tenant_id=current_setting('test.tenant')::uuid and slug='lamp'),(select jsonb_build_object('labels',labels,'category',suggested_category,'active',active,'inherit',inherit_attributes) from item_types where tenant_id is null and slug='lamp'),'copy preserves translated labels, category, active state and inheritance');
select is((select jsonb_agg(jsonb_build_array(attribute_slug,expected,sort) order by attribute_slug) from item_type_attributes where tenant_id=current_setting('test.tenant')::uuid and type_slug='lamp'),(select jsonb_agg(jsonb_build_array(attribute_slug,expected,sort) order by attribute_slug) from item_type_attributes where tenant_id is null and type_slug='lamp'),'entire field profile is copied');
select is((select to_jsonb(p) from pending_operations p where id='f0000000-0000-4000-8000-000000004333'),current_setting('test.proposal')::jsonb,'historical proposal is byte-for-byte unchanged');
select is((select count(*) from item_types where tenant_id=current_setting('test.tenant')::uuid and slug='sweater'),0::bigint,'unused shared type is not copied');
select is((select sum(copied_types)::bigint from komisio_private.copy_used_shared_item_types()),0::bigint,'rerunning the copy is idempotent');
set local role authenticated;
select is((select t->>'own' from jsonb_array_elements(attribute_vocabulary(current_setting('test.tenant')::uuid)->'types') t where t->>'slug'='lamp'),'true','used type is presented as store-owned');
select is(delete_catalogue_record(current_setting('test.tenant')::uuid,'type','lamp')->>'ok','false','copied type remains protected by its historical usage');
select lives_ok($$select set_item_type(current_setting('test.tenant')::uuid,'lamp','{"labels":{"en":"Own lamp"},"active":false,"inheritAttributes":true}')$$,'owner may edit and deactivate the copy');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000004332","role":"authenticated"}';
select throws_ok($$select attribute_vocabulary(current_setting('test.tenant')::uuid)$$,'42501','FORBIDDEN','other tenants cannot read the vocabulary');
select is((select count(*) from item_types where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'direct reads preserve tenant isolation');
select * from finish();
rollback;
