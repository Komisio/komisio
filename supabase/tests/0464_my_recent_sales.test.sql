begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4640000-0000-4000-8000-000000000001','recent-owner@example.test',now()),
 ('f4640000-0000-4000-8000-000000000002','recent-seller@example.test',now()),
 ('f4640000-0000-4000-8000-000000000003','recent-other@example.test',now()),
 ('f4640000-0000-4000-8000-000000000004','recent-unverified@example.test',null);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic recent sales','recent-sales-test',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','recent-seller@example.test','') as seller \gset
select register_seller(:'tenant',gen_random_uuid(),'Other seller','recent-other@example.test','') as other \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","salePeriodDays":42,"markdownSteps":[]}');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','',null) as bag \gset
select set_config('test.tenant',:'tenant',true),set_config('test.bag',:'bag',true);
select throws_ok(format('select my_recent_sales(%L,%L)',:'tenant',:'seller'),'42501','FORBIDDEN','staff membership is not seller identity');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_recent_sales(:'tenant',:'seller')->'items','[]'::jsonb,'empty account has an empty sale list');
select is(my_recent_sales(:'tenant',:'seller')->>'currency','SEK','currency follows store');
select is(my_recent_sales(:'tenant',:'seller')->>'sellerId',:'seller','response bound to seller');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000001","role":"authenticated"}';
create function pg_temp.recent_item(n integer) returns uuid language plpgsql as $$
declare d uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); t uuid:=current_setting('test.tenant')::uuid;
begin
 perform pg_temp.prepare_bag_reception(t,gen_random_uuid(),current_setting('test.bag')::uuid,d,0,'Recent item '||n,'Furniture','Private staff note');
 perform public.accept_item(t,i,'reception_review',d,1,10000);
 return i;
end $$;
create temporary table recent_items as select n,pg_temp.recent_item(n) as id from generate_series(1,28) n;
-- Rollback-only fixture time travel: oldest accepted items are newest sold.
reset role;
alter table public.items disable trigger items_immutable;
update public.items i set accepted_at=now()-(31-r.n)*interval '1 day' from recent_items r where i.id=r.id;
alter table public.items enable trigger items_immutable;
set local role authenticated;
select record_sale(:'tenant',gen_random_uuid(),'manual','RECENT-'||n,now()-greatest(n,2)*interval '1 hour','SEK',jsonb_build_array(jsonb_build_object('itemId',id,'priceOre',9000+n))) from recent_items where n<=27;
select id as oldest_accepted from recent_items where n=1 \gset
select id as fifth from recent_items where n=5 \gset
select l.item_id as tie_first from public.sale_lines l join recent_items r on r.id=l.item_id where r.n in(1,2) order by l.id desc limit 1 \gset
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(jsonb_array_length(my_recent_sales(:'tenant',:'seller')->'items'),5,'bounded to five, not first acceptance-ordered page');
select is(my_recent_sales(:'tenant',:'seller')->>'limit','5','fixed server limit');
select is(my_recent_sales(:'tenant',:'seller')->'items'->0->>'id',:'tie_first','same-time ties use line ID descending');
select is(my_recent_sales(:'tenant',:'seller')->'items'->4->>'id',:'fifth','sale time determines fifth result');
select ok(jsonb_path_query_array(my_recent_sales(:'tenant',:'seller'),'$.items[*].id') @> jsonb_build_array(:'oldest_accepted'::text),'newest sale includes item absent from first acceptance page');
select is(my_recent_sales(:'tenant',:'seller')->'items'->4->>'title','Recent item 5','current title');
select is(my_recent_sales(:'tenant',:'seller')->'items'->4->>'soldPriceOre','9005','recorded sale price, not accepted price or seller share');
select ok(not (my_recent_sales(:'tenant',:'seller')->'items'->0 ?| array['notes','terms','sellerId','commission','account','photos']),'no private fields or uncontracted photos');
select throws_ok(format('select my_recent_sales(%L,%L)',:'tenant',:'other'),'42501','FORBIDDEN','another seller account is forbidden');
select throws_ok(format('select my_recent_sales(%L,%L)',gen_random_uuid(),:'seller'),'42501','FORBIDDEN','another tenant is forbidden');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(my_recent_sales(:'tenant',:'other')->'items','[]'::jsonb,'same-store seller cannot see these sales');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000001","role":"authenticated"}';
select record_return(:'tenant',gen_random_uuid(),(select id from sale_lines where tenant_id=:'tenant' and item_id=:'oldest_accepted'),9001,'Synthetic return');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(not (jsonb_path_query_array(my_recent_sales(:'tenant',:'seller'),'$.items[*].id') @> jsonb_build_array(:'oldest_accepted'::text)),'returned sale omitted');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000001","role":"authenticated"}';
select record_sale(:'tenant',gen_random_uuid(),'manual','RECENT-RESALE',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'oldest_accepted','priceOre',8000)));
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_recent_sales(:'tenant',:'seller')->'items'->0->>'soldPriceOre','8000','resale shows new sale, never returned sale');
select is((select count(*) from jsonb_array_elements(my_recent_sales(:'tenant',:'seller')->'items') x where x->>'id'=:'oldest_accepted'),1::bigint,'resold item appears once');
-- Synthetic non-completed sale, rolled back with the entire fixture.
reset role;
alter table public.sales disable trigger sales_immutable;
update public.sales set status='reversed' where tenant_id=:'tenant' and external_id='RECENT-RESALE';
alter table public.sales enable trigger sales_immutable;
set local role authenticated;
select ok(not (jsonb_path_query_array(my_recent_sales(:'tenant',:'seller'),'$.items[*].id') @> jsonb_build_array(:'oldest_accepted'::text)),'non-completed sale omitted');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(format('select my_recent_sales(%L,%L)',:'tenant',:'seller'),'42501',null,'unverified identity refused');
set local role anon;
select throws_ok(format('select my_recent_sales(%L,%L)',:'tenant',:'seller'),'42501',null,'anonymous execute denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f4640000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select throws_ok(format('select my_recent_sales(%L,%L)',:'tenant',:'seller'),'42501',null,'insufficient MFA refused');
set local "request.jwt.claims"='{"sub":"f4640000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is(jsonb_array_length(my_recent_sales(:'tenant',:'seller')->'items'),5,'verified MFA can read');
reset role;
insert into sellers(id,tenant_id,name,email,created_by) values(gen_random_uuid(),:'tenant','Duplicate','recent-seller@example.test','f4640000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(format('select my_recent_sales(%L,%L)',:'tenant',:'seller'),'42501',null,'ambiguous seller identity denied');
select * from finish();
rollback;
