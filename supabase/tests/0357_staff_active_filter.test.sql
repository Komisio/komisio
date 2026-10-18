begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f3570000-0000-4000-8000-000000000001','filter-owner@example.test',now()),
 ('f3570000-0000-4000-8000-000000000002','filter-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f3570000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Staff active filter','staff-active-filter-test',gen_random_uuid()) as tenant \gset
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
create function pg_temp.search_items(t uuid, f jsonb, s text default 'accepted', d text default 'desc', lim integer default 25, offst integer default 0) returns jsonb language sql as $$
 select public.items_search_page(t,f,s,d,lim,offst)
$$;
select is(pg_temp.search_items(:'tenant','{"stage":"active"}')->>'total','29','active includes all three stages before counting');
select is(jsonb_array_length(pg_temp.search_items(:'tenant','{"stage":"active"}')->'items'),25,'first page is bounded');
select is(jsonb_array_length(pg_temp.search_items(:'tenant','{"stage":"active"}','accepted','desc',25,25)->'items'),4,'filter precedes pagination');
select is(pg_temp.search_items(:'tenant','{"stage":"active"}','accepted','desc',25,50)->>'total','29','empty later page preserves count');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.search_items(:'tenant','{"stage":"active"}')->'items') a join jsonb_array_elements(pg_temp.search_items(:'tenant','{"stage":"active"}','accepted','desc',25,25)->'items') b on a->>'id'=b->>'id'),'pages do not overlap');
select is(pg_temp.search_items(:'tenant','{"stage":"active","q":"Filter item 28"}')->'items'->0->>'stage','markdown_due','due markdown is active');
select is(pg_temp.search_items(:'tenant','{"stage":"active","q":"Filter item 29"}')->'items'->0->>'stage','period_ending','ending is active');
select is(pg_temp.search_items(:'tenant','{"stage":"active","q":"Filter item 30"}')->>'total','0','expired is excluded');
select is(pg_temp.search_items(:'tenant','{"stage":"active","q":"Filter item 31"}')->>'total','0','ended is excluded');
select is(pg_temp.search_items(:'tenant','{"stage":"active","q":"Filter item 32"}')->>'total','0','sold is excluded');
select is(pg_temp.search_items(:'tenant','{"stage":"active","category":"Furniture","ownership":"consignment","minPrice":"100","maxPrice":"100"}','title','asc',25,0)->>'total','29','advanced criteria intersect active before counts');
select is(pg_temp.search_items(:'tenant','{"stage":"active","ownership":"store"}')->>'total','0','ownership intersects active');
select is(pg_temp.search_items(:'tenant','{"stage":"sold"}')->>'total','1','individual stages remain available');
select throws_ok(format('select pg_temp.search_items(%L,%L)',:'tenant','{"stage":"unknown"}'),'INVALID_INPUT','unknown stage rejected');
select throws_ok(format('select pg_temp.search_items(%L,%L)',gen_random_uuid(),'{"stage":"active"}'),'42501',null,'other tenant denied');
reset role;
select ok(not has_function_privilege('anon','public.items_search_page(uuid,jsonb,text,text,integer,integer)','execute'),'anonymous remains denied');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f3570000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
select throws_ok(format('select pg_temp.search_items(%L,%L)',:'tenant','{"stage":"active"}'),'42501',null,'MFA still enforced');
select * from finish();
rollback;
