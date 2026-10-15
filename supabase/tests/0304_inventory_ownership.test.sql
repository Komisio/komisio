begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000951','io-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000952','io-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000000953','io-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000951","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Items overview test','items-overview-test',gen_random_uuid())::text,true);
select set_config('test.s1',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','anna@io.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Blue wool jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'reception_review',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Red coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'reception_review',current_setting('test.d2')::uuid,1,30000);
select set_config('test.p',gen_random_uuid()::text,true);
select register_purchase(current_setting('test.tenant')::uuid,current_setting('test.p')::uuid,'Vintage lamp',15000,'Auction receipt 7',false);
select set_config('test.i3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid,'purchase',current_setting('test.p')::uuid,null,25000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',20000)));


select is((items_directory_page(current_setting('test.tenant')::uuid,null,null,1,0,'store')->>'total')::int,1,'own goods total excludes consignments before pagination');
select is(items_directory_page(current_setting('test.tenant')::uuid,null,null,1,0,'store')->'items'->0->>'id',current_setting('test.i3'),'store ownership returns the purchased item');
select is((items_directory_page(current_setting('test.tenant')::uuid,null,null,1,1,'consignment')->>'total')::int,2,'consignment total includes rows beyond this page');
select is(jsonb_array_length(items_directory_page(current_setting('test.tenant')::uuid,null,null,1,1,'consignment')->'items'),1,'second consignment page is reachable');
select is((items_directory_page(current_setting('test.tenant')::uuid,'lamp','sold',25,0,'store')->>'total')::int,0,'ownership combines with text and lifecycle stage');
select is(items_directory_page(current_setting('test.tenant')::uuid,null,null,25,0,null),items_overview_page(current_setting('test.tenant')::uuid,null,null,25,0),'unfiltered directory preserves the legacy contract');
select throws_ok($$select items_directory_page(current_setting('test.tenant')::uuid,null,null,25,0,'other')$$,'INVALID_INPUT','invalid ownership is refused');
select throws_ok($$select items_directory_page(current_setting('test.tenant')::uuid,null,null,25,-1,'store')$$,'INVALID_INPUT','negative offsets remain refused');
select is(stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30',null),stock_report(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30'),'unfiltered stock preserves every formula');
select is((stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','store')->'total'->>'inStock')::int,1,'own stock count');
select is((stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','store')->'total'->>'stockValueOre')::bigint,25000::bigint,'own stock selling value');
select is((stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','consignment')->'total'->>'inStock')::int,1,'sold consignment excluded from stock');
select is((stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','consignment')->'total'->>'soldCount')::int,1,'sold consignment remains in period report');
select is((stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','store')->'total'->>'soldCount')::int,0,'own sales exclude consignments');
select throws_ok($$select stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','other')$$,'INVALID_INPUT','stock ownership input checked');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000952','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000952","role":"authenticated"}';
select lives_ok($$select items_directory_page(current_setting('test.tenant')::uuid,null,null,25,0,'store')$$,'read-only staff can filter goods');
select lives_ok($$select stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','store')$$,'read-only staff can filter stock');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000953","role":"authenticated"}';
select throws_ok($$select items_directory_page(current_setting('test.tenant')::uuid,null,null,25,0,'store')$$,'42501',null,'outsider cannot filter another store');
select throws_ok($$select stock_report_by_ownership(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30','store')$$,'42501',null,'outsider cannot read own-goods totals');
reset role;
select ok(not has_function_privilege('anon','public.items_directory_page(uuid,text,text,integer,integer,text)','execute'),'anonymous directory read denied');
select ok(not has_function_privilege('anon','public.stock_report_by_ownership(uuid,date,date,text)','execute'),'anonymous stock read denied');
select * from finish();
rollback;
