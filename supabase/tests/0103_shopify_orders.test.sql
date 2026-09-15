begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000995','shopify-order-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000996','shopify-order-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000995","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Shopify orders','shopify-orders-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@shopify-orders.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea market',15000,'Receipt 7',true)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
create function pg_temp.ord(g text,n text,sku text,price bigint,qty integer default 1,cur text default 'SEK',tst boolean default false,canc boolean default false,st text default 'PAID',at timestamptz default now()-interval '1 hour') returns jsonb language sql as $$
 select jsonb_build_object('orderGid','gid://shopify/Order/'||g,'name',n,'occurredAt',at,'updatedAt',at,'currency',cur,'amountOre',price,'financialStatus',st,'test',tst,'cancelled',canc,
  'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'sku',sku,'description','Line','quantity',qty,'priceOre',price)));
$$;

select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'2026-09-15T00:00:00Z','[]'::jsonb)$$,'%SHOPIFY_NOT_CONNECTED%','no orders without a connection');
select store_shopify_connection(current_setting('test.tenant')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb,'read_orders',now()+interval '1 hour');
select matches(shopify_order_cursor(current_setting('test.tenant')::uuid),'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$','the first watermark is the connection time');
select set_config('test.c0',shopify_order_cursor(current_setting('test.tenant')::uuid),true);
select set_config('test.page1',gen_random_uuid()::text,true);
create temp view page1 as select jsonb_build_array(
 pg_temp.ord('1','#1001','K-'||current_setting('test.item1'),25000),
 pg_temp.ord('2','#1002','ABC-123',25000),
 pg_temp.ord('3','#1003','K-'||current_setting('test.item2'),25000,tst=>true),
 pg_temp.ord('4','#1004','K-'||current_setting('test.item2'),50000,qty=>2),
 pg_temp.ord('5','#1005','K-'||current_setting('test.item2'),25000,cur=>'EUR'),
 pg_temp.ord('6','#1006','K-99999999-9999-4999-8999-999999999999',25000)) as p;
select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page1')::uuid,'2000-01-01T00:00:00Z','2026-09-15T00:00:00Z',(select p from page1))$$,'%SHOPIFY_CURSOR_CHANGED%','a page must continue from the stored watermark');
select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page1')::uuid,current_setting('test.c0'),null,(select p from page1))$$,'%INVALID_INPUT%','orders need a new watermark');
select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page1')::uuid,current_setting('test.c0'),'2026-09-15T00:00:00Z',jsonb_build_array(pg_temp.ord('9','#9','x',1)||'{"lines":[]}'::jsonb))$$,'%INVALID_INPUT%','an order without lines is refused');
select is(record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page1')::uuid,current_setting('test.c0'),'2026-09-15T00:00:00Z',(select p from page1)),current_setting('test.page1')::uuid,'first page recorded');
select is(shopify_order_cursor(current_setting('test.tenant')::uuid),'2026-09-15T00:00:00Z','watermark moved');
select is((shopify_order_status(current_setting('test.tenant')::uuid)->>'held')::int,5,'five orders held');
select is(jsonb_array_length(shopify_order_status(current_setting('test.tenant')::uuid)->'orders'),6,'six orders listed');
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),1::bigint,'one sale recorded');
select is((select external_id from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),'gid://shopify/Order/1','the order id is the external id');
select is((select hold_reason from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1002'),'unknown_sku','foreign sku held');
select is((select hold_reason from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1003'),'test','test order held');
select is((select hold_reason from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1004'),'quantity','two units held');
select is((select hold_reason from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1005'),'currency','foreign currency held');
select is((select hold_reason from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1006'),'missing_item','unknown item held');
select is((select lines->0->>'itemId' from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1001'),current_setting('test.item1'),'matched line carries the item');
select is((select o.sale_id::text from shopify_order_outcomes o join shopify_orders s on s.id=o.order_id where s.tenant_id=current_setting('test.tenant')::uuid and s.name='#1001'),(select id::text from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),'outcome names the sale');
select is((select count(*) from item_events where tenant_id=current_setting('test.tenant')::uuid and item_id=current_setting('test.item1')::uuid and kind='sold'),1::bigint,'item marked sold');

-- Replay and conflicts.
select is(record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page1')::uuid,current_setting('test.c0'),'2026-09-15T00:00:00Z',(select p from page1)),current_setting('test.page1')::uuid,'replay returns the page');
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),1::bigint,'replay records nothing');
select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page1')::uuid,current_setting('test.c0'),'2026-09-16T00:00:00Z',(select p from page1))$$,'%REQUEST_CONFLICT%','a request id with other content is refused');
select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T00:00:00Z','2026-09-16T00:00:00Z','[]'::jsonb)$$,'%INVALID_INPUT%','an empty page keeps the watermark');
select set_config('test.page2',gen_random_uuid()::text,true);
select is(record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page2')::uuid,'2026-09-15T00:00:00Z','2026-09-15T00:00:00Z','[]'::jsonb),current_setting('test.page2')::uuid,'empty page recorded');

-- The same order again is skipped; the sold item again is held with the engine's reason; a changed order is held.
select set_config('test.page3',gen_random_uuid()::text,true);
select record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page3')::uuid,'2026-09-15T00:00:00Z','2026-09-15T01:00:00Z',jsonb_build_array(
 pg_temp.ord('1','#1001','K-'||current_setting('test.item1'),25000),
 pg_temp.ord('7','#1007','K-'||current_setting('test.item1'),25000)));
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),1::bigint,'the same order makes no second sale');
select is((select count(*) from shopify_orders where tenant_id=current_setting('test.tenant')::uuid),7::bigint,'seven distinct orders');
select is((select o.error_code from shopify_order_outcomes o join shopify_orders s on s.id=o.order_id where s.tenant_id=current_setting('test.tenant')::uuid and s.name='#1007'),'ITEM_ALREADY_SOLD','a sold item sold again is held with the reason');
select set_config('test.o7',(select id::text from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1007'),true);
select is(reconcile_shopify_order(current_setting('test.tenant')::uuid,current_setting('test.o7')::uuid),null,'retry still fails');
select is((select count(*) from shopify_order_outcomes where tenant_id=current_setting('test.tenant')::uuid and order_id=current_setting('test.o7')::uuid),1::bigint,'same failure not recorded twice');
select throws_like($$select reconcile_shopify_order(current_setting('test.tenant')::uuid,(select id from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1002'))$$,'%SHOPIFY_ORDER_HELD%','a held order is not retried into a sale');
select set_config('test.page4',gen_random_uuid()::text,true);
select record_shopify_order_page(current_setting('test.tenant')::uuid,current_setting('test.page4')::uuid,'2026-09-15T01:00:00Z','2026-09-15T02:00:00Z',jsonb_build_array(pg_temp.ord('1','#1001','K-'||current_setting('test.item1'),20000)));
select is((select count(*) from shopify_order_outcomes o join shopify_orders s on s.id=o.order_id where s.tenant_id=current_setting('test.tenant')::uuid and s.name='#1001' and o.error_code='SHOPIFY_ORDER_CHANGED'),1::bigint,'a changed order is flagged once');
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T02:00:00Z','2026-09-15T03:00:00Z',jsonb_build_array(pg_temp.ord('1','#1001','K-'||current_setting('test.item1'),20000)));
select is((select count(*) from shopify_order_outcomes o join shopify_orders s on s.id=o.order_id where s.tenant_id=current_setting('test.tenant')::uuid and s.name='#1001' and o.error_code='SHOPIFY_ORDER_CHANGED'),1::bigint,'not flagged again');
-- A deployment that accepts test orders (the pilot on a development shop) records them.
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T03:00:00Z','2026-09-15T04:00:00Z',jsonb_build_array(pg_temp.ord('8','#1008','K-'||current_setting('test.item2'),25000,tst=>true)),true);
select is((select hold_reason from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1008'),null,'accepted test order is not held');
select is((select is_test from shopify_orders where tenant_id=current_setting('test.tenant')::uuid and name='#1008'),true,'the evidence still says test');
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),2::bigint,'accepted test order recorded as a sale');
select throws_ok($$update shopify_orders set name='x' where tenant_id=current_setting('test.tenant')::uuid$$,'42501',null,'members cannot edit evidence');
reset role;
select throws_ok($$delete from shopify_order_pulls where tenant_id=current_setting('test.tenant')::uuid$$,'55000',null,'pages are immutable');
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000996','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000996","role":"authenticated"}';
select is((shopify_order_status(current_setting('test.tenant')::uuid)->>'pulls')::int,6,'staff see the pull status');
select throws_ok($$select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T04:00:00Z','2026-09-15T04:00:00Z','[]'::jsonb)$$,'42501',null,'staff cannot record pages');
select throws_ok($$select shopify_order_cursor(current_setting('test.tenant')::uuid)$$,'42501',null,'staff do not read the watermark');
select * from finish();
rollback;
