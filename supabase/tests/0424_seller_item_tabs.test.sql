begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f3540000-0000-4000-8000-000000000001','filter-owner@example.test',now()),
 ('f3540000-0000-4000-8000-000000000002','filter-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Portal filter','portal-filter-test',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','filter-seller@example.test','') as seller \gset
select register_seller(:'tenant',gen_random_uuid(),'Other seller','unrelated@example.test','') as other \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","salePeriodDays":42,"markdownSteps":[]}');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','',null) as bag \gset
select set_config('test.tenant',:'tenant',true),set_config('test.bag',:'bag',true);
create function pg_temp.filter_item(n integer) returns uuid language plpgsql as $$
declare d uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); t uuid:=current_setting('test.tenant')::uuid;
begin
 perform pg_temp.prepare_bag_reception(t,gen_random_uuid(),current_setting('test.bag')::uuid,d,0,'Filter item '||n,'Furniture','Private note');
 perform public.accept_item(t,i,'reception_review',d,1,10000);
 return i;
end $$;
select pg_temp.filter_item(n) from generate_series(1,27) n;
select pg_temp.filter_item(28) as due \gset
select pg_temp.filter_item(29) as ending \gset
select pg_temp.filter_item(30) as expired \gset
select pg_temp.filter_item(31) as ended \gset
select pg_temp.filter_item(32) as sold \gset
-- Transaction-local fixture time travel only; production history stays immutable.
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=now()-interval '41 days' where id=:'ending';
update public.items set accepted_at=now()-interval '43 days' where id in (:'expired',:'ended');
update public.items set terms=jsonb_set(terms,'{markdownSteps}','[{"afterDays":0,"percent":10}]') where id=:'due';
alter table public.items enable trigger items_immutable;
set local role authenticated;
select end_sale_period(:'tenant',gen_random_uuid(),:'ended','charity','Synthetic handover');
select record_sale(:'tenant',gen_random_uuid(),'manual','FILTER-1',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'sold','priceOre',9000)));

set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_items_page(:'tenant',:'seller','',0,'sold')->'counts','{"active":29,"sold":1,"ended":2}'::jsonb,'counts cover every group before status filtering');
select is(my_items_page(:'tenant',:'seller','',100,'active')->'counts','{"active":29,"sold":1,"ended":2}'::jsonb,'counts survive empty later pages');
select is(my_items_page(:'tenant',:'seller','Filter item 32',0,'active')->'counts','{"active":0,"sold":1,"ended":0}'::jsonb,'counts share the search scope across groups');
select ok((my_items_page(:'tenant',:'seller','Filter item 31',0,'ended')->'items'->0->>'endedAt') is not null,'explicitly ended item has actual end date');
select is(my_items_page(:'tenant',:'seller','Filter item 30',0,'ended')->'items'->0->>'endedAt',my_items_page(:'tenant',:'seller','Filter item 30',0,'ended')->'items'->0->>'periodEnd','expired item uses period boundary');
select is(my_items_page(:'tenant',:'seller','Filter item 32',0,'sold')->'items'->0->>'endedAt',null,'sold item does not acquire an end date');
select my_items_page(:'tenant',:'seller','Filter item 31',0,'ended')->'items'->0->>'endedAt' as ended_at \gset
set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000001","role":"authenticated"}';
select correct_item_period_end(:'tenant',gen_random_uuid(),:'ended',(select id from item_events where item_id=:'ended' and kind='period_ended' order by occurred_at desc limit 1),'return','Synthetic correction');
set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_items_page(:'tenant',:'seller','Filter item 31',0,'ended')->'items'->0->>'endedAt',:'ended_at','reason correction keeps original end date');
select is(my_items_page(:'tenant',:'seller','Filter item 31',0,'ended')->'items'->0->>'endedAs','return','reason follows latest correction');
set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000001","role":"authenticated"}';
select reopen_item_period(:'tenant',gen_random_uuid(),:'ended',(select id from item_events where item_id=:'ended' and kind='period_end_corrected' order by occurred_at desc limit 1),current_date+20,'Synthetic reopen');
set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_items_page(:'tenant',:'seller','',0,'sold')->'counts','{"active":30,"sold":1,"ended":1}'::jsonb,'reopened item moves between complete status counts');
select is(my_items_page(:'tenant',:'seller','Filter item 31',0,'active')->'items'->0->>'endedAt',null,'reopened item has no stale end date');
select * from finish();
rollback;
