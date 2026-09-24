begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('f2510000-0000-4000-8000-000000000001','snapshot-owner@example.test',now()),
('f2510000-0000-4000-8000-000000000002','snapshot-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2510000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Snapshot','snapshot-test',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','','123') as seller \gset
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'count','0','empty is zero');
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'oldest',null,'empty has no invented age');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','First',null) as bag \gset
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','Untouched',null) from generate_series(1,24);
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'count','25','counts all pages');
select is((store_flow_snapshot(:'tenant')->'dropoffs'->>'oldest')::timestamptz,now(),'age uses actual receipt time');
select is(jsonb_array_length(flow_dropoff_page(:'tenant','unstarted',null,null,null,null)),21,'queue remains paginated');
select create_bag_reception(:'tenant',gen_random_uuid(),:'seller',:'bag') as session \gset
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'count','24','started registration excludes the drop-off');
select is(store_flow_snapshot(:'tenant')->'reception'->'preparing'->>'count','1','session counts as one item');
select create_reception_session(:'tenant',gen_random_uuid(),:'seller') from generate_series(1,24);
select is(store_flow_snapshot(:'tenant')->'reception'->'preparing'->>'count','25','reception count exceeds page limit');
select is((select count(*) from reception_queue(:'tenant','preparing')),21::bigint,'original page limit retained');
select is((store_flow_snapshot(:'tenant')->'reception'->'preparing'->>'count')::bigint,(select count(*) from reception_queue_facts(:'tenant','preparing')),'summary and queue share facts');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','Draft delivery',null) as draftbag \gset
select gen_random_uuid() as draft \gset
select save_inspection_draft(:'tenant',gen_random_uuid(),:'draftbag',:'draft',0,'Chair','','');
select save_inspection_draft(:'tenant',gen_random_uuid(),:'draftbag',:'draft',1,'Chair updated','','');
select is(store_flow_snapshot(:'tenant')->'drafts'->>'count','1','revisions do not multiply drafts');
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'count','24','draft also starts a drop-off');
select is(jsonb_array_length(flow_dropoff_page(:'tenant','drafts',null,null,null,null)),1,'draft link selects affected drop-off');
select gen_random_uuid() as item \gset
select accept_item(:'tenant',:'item','inspection_draft',:'draft',2,15000);
select is(store_flow_snapshot(:'tenant')->'drafts'->>'count','0','accepted draft leaves pending work');
select is(store_flow_snapshot(:'tenant')->'inventory'->'on_sale'->>'count','1','accepted item appears in inventory');
select is(store_flow_snapshot(:'tenant')->'inventory'->'on_sale'->>'count',items_overview(:'tenant',null,'on_sale',1)->>'total','inventory uses existing lifecycle');
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'count','24','acceptance does not put delivery back in unstarted queue');
select save_inspection_draft(:'tenant',gen_random_uuid(),:'draftbag',gen_random_uuid(),0,'Second chair','','');
select is(store_flow_snapshot(:'tenant')->'drafts'->>'count','1','partially registered delivery still has pending item');
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin"}');
-- Sale validation uses frozen VAT-independent terms and current store VAT policy.
select record_sale(:'tenant',gen_random_uuid(),'manual','Snapshot sale',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',15000)));
select is(store_flow_snapshot(:'tenant')->'inventory'->'sold'->>'count','1','sold items are separate');
select ok(not (store_flow_snapshot(:'tenant')->'inventory' ? 'on_sale'),'sold item no longer on sale');
select throws_like(format('select flow_dropoff_page(%L,%L,null,null,1,2)',:'tenant','unstarted'),'%INVALID_INPUT%','conflicting pagination refused');
select throws_like(format('select flow_dropoffs(%L,%L)',:'tenant','invalid'),'%INVALID_INPUT%','unknown filter refused');
select create_tenant('Other snapshot','other-snapshot',gen_random_uuid()) as other \gset
select is(store_flow_snapshot(:'other')->'dropoffs'->>'count','0','other tenant does not inherit counts');
select is(store_flow_snapshot(:'other')->'reception','{}'::jsonb,'other tenant does not inherit sessions');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f2510000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2510000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(store_flow_snapshot(:'tenant')->'dropoffs'->>'count','24','readonly sees authorized snapshot');
select throws_ok(format('select store_flow_snapshot(%L)',:'other'),'42501',null,'outsider snapshot denied');
select throws_ok(format('select * from reception_queue_facts(%L)',:'other'),'42501',null,'shared reception read checks membership');
select throws_ok(format('select * from flow_dropoffs(%L,%L)',:'other','unstarted'),'42501',null,'shared drop-off read checks membership');
set local role anon;
select throws_ok(format('select store_flow_snapshot(%L)',:'tenant'),'42501',null,'anonymous snapshot denied');
select throws_ok(format('select * from reception_queue_facts(%L)',:'tenant'),'42501',null,'anonymous facts denied');
select * from finish();
rollback;
