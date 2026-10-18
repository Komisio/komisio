begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f3580000-0000-4000-8000-000000000001','filter-owner@example.test',now()),
 ('f3580000-0000-4000-8000-000000000002','filter-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f3580000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Stock lifecycle','stock-lifecycle-test',gen_random_uuid()) as tenant \gset
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
-- A due markdown can also be nearing period end.
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=now()-interval '41 days' where id=:'due';
alter table public.items enable trigger items_immutable;
set local role authenticated;
select set_item_price(:'tenant',gen_random_uuid(),:'due',12000,'Current price fixture');
select gen_random_uuid() as purchase,gen_random_uuid() as owned \gset
select register_purchase(:'tenant',:'purchase','Store item',5000,'Synthetic receipt',false);
select accept_item(:'tenant',:'owned','purchase',:'purchase',null,25000);
select stock_lifecycle_report(:'tenant')::text as report \gset
select is(:'report'::jsonb->>'currency','SEK','store currency');
select is(:'report'::jsonb->'stages'->>'active','30','active counts only stock in three active stages');
select is(:'report'::jsonb->'stages'->>'on_sale','28','on sale includes store-owned stock');
select is(:'report'::jsonb->'stages'->>'markdown_due','1','due markdown count');
select is(:'report'::jsonb->'stages'->>'period_ending','1','derived period-ending count');
select is(:'report'::jsonb->'stages'->>'period_ended','1','expired remains in stock until ended');
select is(:'report'::jsonb->>'nearingPeriodEnd','2','upcoming includes due markdown and ending, excludes sold/ended/expired');
select is(:'report'::jsonb->'ownership'->'consignment'->>'inStock','30','consignment stock count');
select is(:'report'::jsonb->'ownership'->'consignment'->>'stockValueOre','302000','latest consignment price is used');
select is(:'report'::jsonb->'ownership'->'store'->>'inStock','1','store stock count');
select is(:'report'::jsonb->'ownership'->'store'->>'stockValueOre','25000','store current value');
select is(stock_report(:'tenant',current_date,current_date)->'total'->>'stockValueOre','327000','ownership values agree with unchanged stock report');
select is(stock_report(:'tenant',current_date,current_date)->'total'->>'inStock','31','stage counts retain original stock membership');
select is(stock_lifecycle_report(:'tenant','store')->'stages'->>'active','1','ownership scopes stages');
select is(stock_lifecycle_report(:'tenant','store')->>'nearingPeriodEnd','0','ownership scopes upcoming');
select is(stock_lifecycle_report(:'tenant','store')->'ownership'->'consignment'->>'stockValueOre','0','excluded ownership has zero value');
create function pg_temp.search_items(t uuid,f jsonb,offst integer default 0) returns jsonb language sql as $$
 select public.items_search_page(t,f,'title','asc',25,offst)
$$;
select is(pg_temp.search_items(:'tenant','{"periodWindow":"next7days"}')->>'total',:'report'::jsonb->>'nearingPeriodEnd','card matches list');
select is(pg_temp.search_items(:'tenant','{"periodWindow":"next7days","stage":"markdown_due"}')->>'total','1','window intersects stage');
select is(pg_temp.search_items(:'tenant','{"periodWindow":"next7days","ownership":"store"}')->>'total','0','window intersects ownership');
select is(pg_temp.search_items(:'tenant','{"periodWindow":"next7days","q":"Filter item 28"}')->>'total','1','window intersects search');
select ok(not exists(select 1 from jsonb_each(:'report'::jsonb->'stages') s where s.value::text<>(pg_temp.search_items(:'tenant',jsonb_build_object('stage',s.key))->>'total')),'every stage card matches its list');
select throws_ok(format('select pg_temp.search_items(%L,%L)',:'tenant','{"periodWindow":"last7days"}'),'INVALID_INPUT','unknown period window rejected');
-- Boundary checks run as database test owner; this predicate is not a client API.
reset role;
select ok(not komisio_private.stock_period_nearing_end('on_sale',now()),'ending exactly now is expired');
select ok(komisio_private.stock_period_nearing_end('markdown_due',now()+interval '7 days'),'inclusive seven-day boundary');
select ok(not komisio_private.stock_period_nearing_end('on_sale',now()+interval '7 days 1 microsecond'),'beyond boundary excluded');
select ok(not komisio_private.stock_period_nearing_end('sold',now()+interval '1 day'),'sold excluded even with future end');
select ok(not komisio_private.stock_period_nearing_end('ended',now()+interval '1 day'),'ended excluded even with future end');
select ok(not has_function_privilege('authenticated','komisio_private.stock_period_nearing_end(text,timestamptz)','execute'),'private predicate is not exposed');
-- Time travel only in the rolled-back fixture: enough upcoming rows for a second page.
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=now()-interval '41 days' where tenant_id=:'tenant' and id not in (:'expired',:'ended',:'due',:'ending');
alter table public.items enable trigger items_immutable;
set local role authenticated;
select is(pg_temp.search_items(:'tenant','{"periodWindow":"next7days"}')->>'total','30','all eligible stock counted before paging');
select is(jsonb_array_length(pg_temp.search_items(:'tenant','{"periodWindow":"next7days"}')->'items'),25,'upcoming first page bounded');
select is(jsonb_array_length(pg_temp.search_items(:'tenant','{"periodWindow":"next7days"}',25)->'items'),5,'upcoming second page retains remaining rows');
select is(stock_lifecycle_report(:'tenant')->>'nearingPeriodEnd',pg_temp.search_items(:'tenant','{"periodWindow":"next7days"}')->>'total','card covers all matching pages');
-- Returned sales re-enter stock and the upcoming window.
select l.id as sold_line from public.sale_lines l where l.tenant_id=:'tenant' and l.item_id=:'sold' \gset
select record_return(:'tenant',gen_random_uuid(),:'sold_line',9000,'Synthetic return');
select is(stock_lifecycle_report(:'tenant')->>'nearingPeriodEnd','31','returned item re-enters upcoming stock');
select is(pg_temp.search_items(:'tenant','{"periodWindow":"next7days"}')->>'total','31','return reflected in list too');
select throws_ok(format('select stock_lifecycle_report(%L,%L)',:'tenant','other'),'INVALID_INPUT','unknown ownership rejected');
select create_tenant('Other lifecycle stock','other-lifecycle-stock',gen_random_uuid()) as other_tenant \gset
select is(stock_lifecycle_report(:'other_tenant')->'stages'->>'active','0','memberships do not mix stock counts');
select is(stock_lifecycle_report(:'other_tenant')->'ownership'->'consignment'->>'stockValueOre','0','empty tenant value is zero');
select throws_ok(format('select stock_lifecycle_report(%L)',gen_random_uuid()),'42501',null,'foreign tenant refused');
set local "request.jwt.claims"='{"sub":"f3580000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(format('select stock_lifecycle_report(%L)',:'tenant'),'42501',null,'seller without membership refused');
reset role;
insert into public.tenant_members(tenant_id,user_id,role) values(:'tenant','f3580000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
select lives_ok(format('select stock_lifecycle_report(%L)',:'tenant'),'readonly member can read counts');
reset role;
select ok(not has_function_privilege('anon','public.stock_lifecycle_report(uuid,text)','execute'),'anonymous refused');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f3580000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f3580000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_ok(format('select stock_lifecycle_report(%L)',:'tenant'),'42501',null,'MFA remains enforced');
select * from finish();
rollback;
