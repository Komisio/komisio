-- Run with psql against an isolated database at the parent migration.
-- This exercises the actual upgrade; ordinary pgTAP runs target the new schema.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('e4580000-0000-4000-8000-000000000001','retirement-owner@example.test',now()),
 ('e4580000-0000-4000-8000-000000000002','retirement-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"e4580000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Retirement fixture','retirement-fixture',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','','123') as seller \gset
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','Synthetic bag',null) as bag \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin"}');
select gen_random_uuid() as origin, gen_random_uuid() as item, gen_random_uuid() as corrected_origin, gen_random_uuid() as corrected_item, gen_random_uuid() as pending_origin \gset
select save_inspection_draft(:'tenant',gen_random_uuid(),:'bag',:'origin',0,'Retired text','Retired category','Good');
select save_inspection_draft(:'tenant',gen_random_uuid(),:'bag',:'corrected_origin',0,'Original text','','Good');
select save_inspection_draft(:'tenant',gen_random_uuid(),:'bag',:'pending_origin',0,'Unaccepted text','','Good');
select accept_item(:'tenant',:'item','inspection_draft',:'origin',1,25000);
select accept_item(:'tenant',:'corrected_item','inspection_draft',:'corrected_origin',1,15000);
select correct_item_attribute(:'tenant',gen_random_uuid(),:'corrected_item','description','Corrected title','Synthetic correction');
select propose_operation(:'tenant',gen_random_uuid(),'acceptItem',jsonb_build_object('originKind','inspection_draft','originId',:'pending_origin','originRevision',1,'priceOre',25000),'Synthetic agent',now()+interval '1 day');
select propose_operation(:'tenant',gen_random_uuid(),'saveInspectionDraft',jsonb_build_object('bagId',:'bag','draftId',:'pending_origin','expectedRevision',1,'fields',jsonb_build_object('description','Proposed text','category','','condition','')),'Synthetic agent',now()+interval '1 day');
create temp table before_items as select * from items where tenant_id=:'tenant';
create temp table before_prices as select * from item_prices where tenant_id=:'tenant';
create temp table before_events as select * from item_events where tenant_id=:'tenant';
reset role;
\ir ../../supabase/migrations/20261015190000_retire_inspection_drafts.sql
select ok(to_regclass('public.inspection_draft_revisions') is null,'all accepted and unaccepted draft sources are dropped');
select is((select jsonb_agg(to_jsonb(i) order by id) from items i where tenant_id=:'tenant'),(select jsonb_agg(to_jsonb(i) order by id) from before_items i),'item identities and terms remain byte-for-byte unchanged');
select is((select jsonb_agg(to_jsonb(i) order by id) from item_prices i where tenant_id=:'tenant'),(select jsonb_agg(to_jsonb(i) order by id) from before_prices i),'prices remain unchanged');
select is((select jsonb_agg(to_jsonb(i) order by id) from item_events i where tenant_id=:'tenant'),(select jsonb_agg(to_jsonb(i) order by id) from before_events i),'financial and provenance history remains unchanged');
select is(komisio_private.item_attributes(:'tenant',:'item'),'[]'::jsonb,'removed descriptions are not copied');
set local role authenticated;
select is((select count(*) from operation_queue_filtered_page(:'tenant','all',null,null,null)),0::bigint,'retired drafts and their acceptance proposals are excluded from the active queue');
select is((select count(*) from pending_operations where tenant_id=:'tenant'),2::bigint,'immutable proposal history remains present');
select is(item_label_facts(:'tenant',:'corrected_item')->>'title','Corrected title','later correction survives source deletion');
select is(item_label_facts(:'tenant',:'item')->>'title','I-'||upper(left(:'item',8)),'label has a usable reference fallback');
select is(bag_registered_items_page(:'tenant',:'bag',0)->>'total','2','legacy bag membership remains readable');
select is(items_search_page(:'tenant',jsonb_build_object('bag',:'bag'),'title','asc',25,0)->>'total','2','bag search includes legacy items');
select is(items_search_page(:'tenant',jsonb_build_object('q','I-'||upper(left(:'item',8))),'title','asc',25,0)->>'total','1','legacy item is searchable by label reference');
select is(items_search_page(:'tenant','{"q":"Corrected title"}','title','asc',25,0)->>'total','1','later title remains searchable');
select is(jsonb_array_length(item_label_sheet_facts(:'tenant',:'bag',null)->'items'),2,'batch labels include legacy items');
select lives_ok(format('select set_bag_processing(%L,gen_random_uuid(),%L,0,%L,%L)',:'tenant',:'bag','completed',''),'deleted unaccepted drafts do not prevent completion');
select throws_ok(format('select accept_item(%L,gen_random_uuid(),%L,gen_random_uuid(),1,10000)',:'tenant','inspection_draft'),'ORIGIN_RETIRED','new inspection acceptance is refused');
select lives_ok(format('select record_sale(%L,gen_random_uuid(),%L,%L,now(),%L,%L::jsonb)',:'tenant','manual','Retirement sale','SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',25000))::text),'legacy item can still be sold');
select ok(not (seller_data_export(:'tenant',:'seller') ? 'inspectionDrafts'),'seller export omits retired source');
set local "request.jwt.claims"='{"sub":"e4580000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(format('select item_label_facts(%L,%L)',:'tenant',:'item'),'42501',null,'retirement does not expose another tenant item');
select * from finish();
rollback;
