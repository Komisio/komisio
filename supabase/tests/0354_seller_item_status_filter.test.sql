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
select throws_ok(format('select my_items_page(%L,%L,%L,0,%L)',:'tenant',:'seller','','active'),'42501','FORBIDDEN','membership cannot read a seller identity');
set local "request.jwt.claims"='{"sub":"f3540000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_items_page(:'tenant',:'seller','',0,'active')->>'total','29','active includes on sale, due markdown and period ending');
select is(jsonb_array_length(my_items_page(:'tenant',:'seller','',0,'active')->'items'),25,'status page is bounded');
select is(jsonb_array_length(my_items_page(:'tenant',:'seller','',25,'active')->'items'),4,'status filtering precedes paging');
select is(my_items_page(:'tenant',:'seller','',50,'active')->>'total','29','empty later page retains filtered total');
select is(my_items_page(:'tenant',:'seller','',0,'sold')->>'total','1','sold count');
select is(my_items_page(:'tenant',:'seller','',0,'ended')->>'total','2','ended includes expired and explicitly ended');
select is(my_items_page(:'tenant',:'seller','',0,'all')->>'total','32','all retains all stages');
select is(my_items_page(:'tenant',:'seller')->>'total','32','legacy signature still returns all stages');
select is(my_items_page(:'tenant',:'seller','Filter item 29',0,'active')->'items'->0->>'stage','period_ending','ending is active');
select is(my_items_page(:'tenant',:'seller','Filter item 28',0,'active')->'items'->0->>'stage','markdown_due','markdown due is active');
select is(my_items_page(:'tenant',:'seller','Filter item 30',0,'ended')->'items'->0->>'stage','period_ended','period ended is ended');
select is(my_items_page(:'tenant',:'seller','Filter item 31',0,'ended')->'items'->0->>'stage','ended','explicitly ended is ended');
select is(my_items_page(:'tenant',:'seller','Filter item 32',0,'sold')->'items'->0->>'soldPriceOre','9000','actual sale amount survives filtering');
select is(my_items_page(:'tenant',:'seller','Filter item 32',0,'active')->>'total','0','search intersects status');
select is(my_items_page(:'tenant',:'seller','I-'||upper(left(:'sold',8)),0,'sold')->>'total','1','label search intersects status');
select is(my_items_page(:'tenant',:'seller','FURNITURE',0,'ended')->>'total','2','category search intersects status');
select is(my_items_page(:'tenant',:'seller','%',0,'all')->>'total','0','search wildcards remain literal');
select ok(not exists(select 1 from jsonb_array_elements(my_items_page(:'tenant',:'seller','',0,'active')->'items') a join jsonb_array_elements(my_items_page(:'tenant',:'seller','',25,'active')->'items') b on a->>'id'=b->>'id'),'pages do not overlap');
select ok(not exists(
 select 1 from (select e->>'acceptedAt' as at,lag(e->>'acceptedAt') over (partition by s order by n) as previous
 from unnest(array['active','sold','ended','all']) s,
 lateral jsonb_array_elements(my_items_page(:'tenant',:'seller','',0,s)->'items') with ordinality a(e,n)) x where at>previous
),'newest acceptance first in every group');
select ok((my_items_page(:'tenant',:'seller','',0,'ended')->'items'->0) ? 'collectionDeadline','collection deadline retained');
select ok(my_items_page(:'tenant',:'seller','',0,'all')::text not like '%Private note%','private notes not exposed');
select throws_like(format('select my_items_page(%L,%L,%L,0,%L)',:'tenant',:'seller','','unknown'),'%INVALID_INPUT%','invalid status rejected');
select throws_like(format('select my_items_page(%L,%L,%L,-1,%L)',:'tenant',:'seller','','active'),'%INVALID_INPUT%','negative offset rejected');
select throws_ok(format('select my_items_page(%L,%L,%L,0,%L)',:'tenant',:'other','','all'),'42501','FORBIDDEN','other seller denied');
select throws_ok(format('select my_items_page(%L,%L,%L,0,%L)',gen_random_uuid(),:'seller','','all'),'42501','FORBIDDEN','other tenant denied');
set local role anon;
select throws_ok(format('select my_items_page(%L,%L,%L,0,%L)',:'tenant',:'seller','','all'),'42501',null,'anonymous filtered read denied');
select * from finish();
rollback;
