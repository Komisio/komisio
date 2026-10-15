begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(to_regclass('public.inspection_draft_revisions') is null, 'inspection revisions are retired');
select ok(to_regclass('public.inspection_current') is null, 'inspection projection is retired');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','komisio_private') and
 (p.proname in ('save_inspection_draft','set_inspection_archived') or p.proname like 'op_%_save_inspection_draft')),0::bigint,
 'draft mutation functions are removed');
select is(komisio_private.valid_operation_payload('saveInspectionDraft','{}'::jsonb),false,
 'retired operation cannot be proposed');
select ok(not (komisio_private.connector_scopes() && array['inspection:read','inspection:preview','inspection:propose']),
 'retired connector permissions cannot be granted');
insert into auth.users(id,email,email_confirmed_at) values
 ('e4580000-0000-4000-8000-000000000011','direct-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"e4580000-0000-4000-8000-000000000011","role":"authenticated"}';
select create_tenant('Direct registration','direct-registration',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','','123') as seller \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"intakeProfile":"full"}');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','Synthetic bag',null) as bag \gset
select create_bag_reception(:'tenant',gen_random_uuid(),:'seller',:'bag') as session \gset
select gen_random_uuid() as request \gset
select quick_receive_from_bag(:'tenant',:'request',:'session',:'seller',0,'{"description":"Direct coat","category":"Coats","condition":"Good"}',25000,:'bag') as result \gset
select is(:'result'::jsonb,quick_receive_from_bag(:'tenant',:'request',:'session',:'seller',0,'{"description":"Direct coat","category":"Coats","condition":"Good"}',25000,:'bag'),'direct registration retries exactly once');
select is((select count(*) from items where tenant_id=:'tenant'),1::bigint,'one item registered under full profile');
select is(item_label_facts(:'tenant',(:'result'::jsonb->>'itemId')::uuid)->>'title','Direct coat','direct item has a label title');
select is(bag_work_summary(:'tenant',:'bag')->>'accepted','1','registered item immediately counts');
select ok(not (bag_work_summary(:'tenant',:'bag') ?| array['drafts','nextDraft']),'summary exposes no draft UI fields');
select lives_ok(format('select set_bag_processing(%L,gen_random_uuid(),%L,0,%L,%L)',:'tenant',:'bag','completed',''),'completed registration allows closing the bag');
select create_reception_session(:'tenant',gen_random_uuid(),:'seller') as standalone \gset
select throws_like(format('select quick_receive(%L,gen_random_uuid(),%L,%L,0,%L,10000)',:'tenant',:'standalone',:'seller','{"description":"Standalone"}'),'%INTAKE_PROFILE_FULL%','full profile still rejects standalone quick receipt');
select * from finish();
rollback;
