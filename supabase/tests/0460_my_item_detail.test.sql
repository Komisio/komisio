begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4600000-0000-4000-8000-000000000001','detail-owner@example.test',now()),
 ('f4600000-0000-4000-8000-000000000002','detail-seller@example.test',now()),
 ('f4600000-0000-4000-8000-000000000003','detail-other@example.test',now()),
 ('f4600000-0000-4000-8000-000000000004','detail-unverified@example.test',null);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4600000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic detail store','seller-detail-test',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','detail-seller@example.test','') as seller \gset
select register_seller(:'tenant',gen_random_uuid(),'Other seller','detail-other@example.test','') as other \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","salePeriodDays":42,"markdownSteps":[]}');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','',null) as bag \gset
select set_config('test.tenant',:'tenant',true),set_config('test.bag',:'bag',true);
create function pg_temp.detail_item(n integer) returns uuid language plpgsql as $$
declare d uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); t uuid:=current_setting('test.tenant')::uuid;
begin
 perform pg_temp.prepare_bag_reception(t,gen_random_uuid(),current_setting('test.bag')::uuid,d,0,'Detail item '||n,'Furniture','Private staff note');
 perform public.accept_item(t,i,'reception_review',d,1,10000);
 return i;
end $$;
select pg_temp.detail_item(1) as active \gset
select pg_temp.detail_item(2) as sold \gset
select pg_temp.detail_item(3) as ended \gset
select pg_temp.detail_item(4) as expired \gset
create temporary table ending_items as select pg_temp.detail_item(n) as id from generate_series(5,31) n;
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=now()-interval '41 days' where id in (select id from ending_items);
update public.items set accepted_at=now()-interval '43 days' where id in (:'expired',:'ended');
alter table public.items enable trigger items_immutable;
set local role authenticated;
select end_sale_period(:'tenant',gen_random_uuid(),:'ended','return','Synthetic return');
select record_sale(:'tenant',gen_random_uuid(),'manual','DETAIL-1',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'sold','priceOre',9000)));
select throws_ok(format('select my_item_detail(%L,%L,%L)',:'tenant',:'seller',:'active'),'42501','FORBIDDEN','store membership is not a seller identity');
set local "request.jwt.claims"='{"sub":"f4600000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_items_page(:'tenant',:'seller','',0,'expiring')->>'total','27','expiring total includes only engine period_ending');
select is(jsonb_array_length(my_items_page(:'tenant',:'seller','',0,'expiring')->'items'),25,'expiring first page bounded');
select is(jsonb_array_length(my_items_page(:'tenant',:'seller','',25,'expiring')->'items'),2,'expiring filtering precedes paging');
select is(my_items_page(:'tenant',:'seller','',50,'expiring')->>'total','27','empty page retains total');
select is(my_items_page(:'tenant',:'seller','Detail item 31',0,'expiring')->>'total','1','search intersects expiring status');
select is(my_items_page(:'tenant',:'seller','',0,'expiring')->'counts','{"active":28,"sold":1,"ended":2}'::jsonb,'legacy counts shape preserved');
select is(my_items_page(:'tenant',:'seller')->>'total','31','legacy read retains all stages');
select is(my_item_detail(:'tenant',:'seller',i)->'item',my_items_page(:'tenant',:'seller',i::text,0,'all')->'items'->0,'exact detail matches list facts for '||i)
 from unnest(array[:'active'::uuid,:'sold'::uuid,:'ended'::uuid,:'expired'::uuid]) i;
select is(my_item_detail(:'tenant',:'seller',id)->'item',my_items_page(:'tenant',:'seller',id::text,0,'all')->'items'->0,'exact ending detail independent of list page') from ending_items;
select is(my_item_detail(:'tenant',:'seller',:'sold')->'item'->>'soldPriceOre','9000','actual sold price, not current or accepted price');
select is(my_item_detail(:'tenant',:'seller',:'active')->>'currency','SEK','currency included');
select is(my_item_detail(:'tenant',:'seller',:'active')->>'automaticMarkdowns',my_items_page(:'tenant',:'seller')->>'automaticMarkdowns','store markdown policy unchanged');
select ok(not (my_item_detail(:'tenant',:'seller',:'active')->'item' ?| array['sellerId','notes','commission','photos','terms']),'private data and media are absent');
select throws_like(format('select my_item_detail(%L,%L,%L)',:'tenant',:'seller',gen_random_uuid()),'%ITEM_NOT_FOUND%','unknown item is unavailable');
select throws_like(format('select my_item_detail(%L,%L,null)',:'tenant',:'seller'),'%ITEM_NOT_FOUND%','null item is unavailable');
select throws_ok(format('select my_item_detail(%L,%L,%L)',:'tenant',:'other',:'active'),'42501','FORBIDDEN','cannot select another seller account');
select throws_ok(format('select my_item_detail(%L,%L,%L)',gen_random_uuid(),:'seller',:'active'),'42501','FORBIDDEN','cannot select another tenant');
set local "request.jwt.claims"='{"sub":"f4600000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like(format('select my_item_detail(%L,%L,%L)',:'tenant',:'other',:'active'),'%ITEM_NOT_FOUND%','other-owned id has the same unavailable response');
set local "request.jwt.claims"='{"sub":"f4600000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(format('select my_item_detail(%L,%L,%L)',:'tenant',:'seller',:'active'),'42501',null,'unverified identity refused');
set local role anon;
select throws_ok(format('select my_item_detail(%L,%L,%L)',:'tenant',:'seller',:'active'),'42501',null,'anonymous execute denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f4600000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4600000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select throws_ok(format('select my_item_detail(%L,%L,%L)',:'tenant',:'seller',:'active'),'42501',null,'insufficient MFA refused');
select throws_ok(format('select my_items_page(%L,%L,%L,0,%L)',:'tenant',:'seller','','expiring'),'42501',null,'expiring list enforces MFA');
set local "request.jwt.claims"='{"sub":"f4600000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is(my_item_detail(:'tenant',:'seller',:'active')->'item'->>'id',:'active','verified MFA can read own detail');
reset role;
insert into sellers(id,tenant_id,name,email,created_by) values(gen_random_uuid(),:'tenant','Duplicate','detail-seller@example.test','f4600000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(format('select my_item_detail(%L,%L,%L)',:'tenant',:'seller',:'active'),'42501',null,'ambiguous seller account denied');
select * from finish();
rollback;
