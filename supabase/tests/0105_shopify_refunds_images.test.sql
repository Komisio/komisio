begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000999','shopify-refund-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000990','shopify-refund-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000999","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Shopify refunds','shopify-refunds-test',gen_random_uuid())::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','refund-seller@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Test only','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Test evidence');
-- A reception item with a photo (image path) and a purchased item (no photo).
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.photo',gen_random_uuid()::text,true);
select set_config('test.path',current_setting('test.tenant')||'/'||current_setting('test.session')||'/'||current_setting('test.photo')||'.jpg',true);
reset role;
insert into storage.objects(bucket_id,name) values('reception-photos',current_setting('test.path'));
set local role authenticated;
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,jsonb_build_array(jsonb_build_object('id',current_setting('test.photo'),'kind','photo','reference',current_setting('test.path'),'observation',''),jsonb_build_object('id','f0000000-0000-4000-8000-000000000938','kind','price-evidence','reference','Staff','observation','Test appraisal')));
select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,jsonb_build_object('attributes',jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value','Test jacket','sourceIds',jsonb_build_array(current_setting('test.photo')),'certainty','observed')),'price',jsonb_build_object('currency','SEK','amount','100.00','rationale','Test','sourceIds',jsonb_build_array('f0000000-0000-4000-8000-000000000938'::text)),'questions','[]'::jsonb),now()+interval '1 day');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'reception_review',current_setting('test.session')::uuid,1,10000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea market',15000,'Receipt 7',true)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000);
select store_shopify_connection(current_setting('test.tenant')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb,'read_orders',now()+interval '1 hour');
select set_config('test.c0',shopify_order_cursor(current_setting('test.tenant')::uuid),true);
create function pg_temp.ord(g text,n text,sku text,price bigint,st text default 'PAID',refunds jsonb default null,at timestamptz default now()-interval '2 hours') returns jsonb language sql as $$
 select jsonb_build_object('orderGid','gid://shopify/Order/'||g,'name',n,'occurredAt',at,'updatedAt',at,'currency','SEK','amountOre',price,'financialStatus',st,'test',false,'cancelled',false,
  'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'sku',sku,'description','Line','quantity',1,'priceOre',price)))
  || case when refunds is null then '{}'::jsonb else jsonb_build_object('refunds',refunds) end;
$$;
create function pg_temp.refund(g text,sku text,amount bigint) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('refundGid','gid://shopify/Refund/'||g,'occurredAt',now()-interval '1 hour','amountOre',amount,'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'sku',sku,'quantity',1,'amountOre',amount))));
$$;

-- Refunds.
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.c0'),'2026-09-15T00:00:00Z',jsonb_build_array(
 pg_temp.ord('1','#2001','K-'||current_setting('test.item2'),25000),
 pg_temp.ord('2','#2002','K-'||current_setting('test.item1'),10000)));
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid and provider='shopify'),2::bigint,'two sales recorded');
select throws_like($$select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T00:00:00Z','2026-09-15T01:00:00Z',jsonb_build_array(pg_temp.ord('1','#2001','K-'||current_setting('test.item2'),25000,'REFUNDED','[{"refundGid":"x"}]'::jsonb)))$$,'%INVALID_INPUT%','malformed refunds are refused');
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T00:00:00Z','2026-09-15T01:00:00Z',jsonb_build_array(
 pg_temp.ord('1','#2001','K-'||current_setting('test.item2'),25000,'REFUNDED',pg_temp.refund('11','K-'||current_setting('test.item2'),25000))));
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'the whole-line refund became a return');
select is((select refund_ore from sale_returns where tenant_id=current_setting('test.tenant')::uuid),25000::bigint,'return carries the line price');
select is((select count(*) from item_events where tenant_id=current_setting('test.tenant')::uuid and item_id=current_setting('test.item2')::uuid and kind='returned'),1::bigint,'item marked returned');
select is((select count(*) from shopify_order_outcomes o join shopify_orders s on s.id=o.order_id where s.tenant_id=current_setting('test.tenant')::uuid and o.error_code='SHOPIFY_ORDER_CHANGED'),0::bigint,'a refund is not a changed order');
select is((select return_id is not null from shopify_refund_outcomes where tenant_id=current_setting('test.tenant')::uuid),true,'refund outcome names the return');
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T01:00:00Z','2026-09-15T02:00:00Z',jsonb_build_array(
 pg_temp.ord('1','#2001','K-'||current_setting('test.item2'),25000,'REFUNDED',pg_temp.refund('11','K-'||current_setting('test.item2'),25000))));
select is((select count(*) from shopify_refunds where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'the same refund again is not stored twice');
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'and makes no second return');
-- A partial refund and a refund of a foreign line are held with the rule's code.
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T02:00:00Z','2026-09-15T03:00:00Z',jsonb_build_array(
 pg_temp.ord('2','#2002','K-'||current_setting('test.item1'),10000,'PARTIALLY_REFUNDED',pg_temp.refund('21','K-'||current_setting('test.item1'),5000) || pg_temp.refund('22','OTHER-1',1000))));
select is((select error_code from shopify_refund_outcomes o join shopify_refunds r on r.id=o.refund_id where r.tenant_id=current_setting('test.tenant')::uuid and r.refund_gid='gid://shopify/Refund/21'),'PARTIAL_REFUND_UNSUPPORTED','partial refund held with the return rule code');
select is((select error_code from shopify_refund_outcomes o join shopify_refunds r on r.id=o.refund_id where r.tenant_id=current_setting('test.tenant')::uuid and r.refund_gid='gid://shopify/Refund/22'),'SHOPIFY_REFUND_LINE_UNKNOWN','foreign refunded line held');
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'held refunds make no return');
select is((select (o->>'returned')::int from jsonb_array_elements(shopify_order_status(current_setting('test.tenant')::uuid)->'orders') o where o->>'name'='#2001'),1,'status shows the return');
select is((select (o->>'refundsHeld')::int from jsonb_array_elements(shopify_order_status(current_setting('test.tenant')::uuid)->'orders') o where o->>'name'='#2002'),2,'status shows held refunds');
-- A refunded order for an item still sold elsewhere: the sale is refused, so its refund has nothing to return.
select record_shopify_order_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'2026-09-15T03:00:00Z','2026-09-15T04:00:00Z',jsonb_build_array(
 pg_temp.ord('3','#2003','K-'||current_setting('test.item1'),10000,'REFUNDED',pg_temp.refund('31','K-'||current_setting('test.item1'),10000))));
select is((select error_code from shopify_order_outcomes o join shopify_orders s on s.id=o.order_id where s.tenant_id=current_setting('test.tenant')::uuid and s.name='#2003'),'ITEM_ALREADY_SOLD','a second sale of the same item is refused as before');
select is((select error_code from shopify_refund_outcomes o join shopify_refunds r on r.id=o.refund_id where r.tenant_id=current_setting('test.tenant')::uuid and r.refund_gid='gid://shopify/Refund/31'),'SHOPIFY_SALE_MISSING','its refund is held because there is no sale');
select throws_like($$select record_return(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid(),100,'By hand',now())$$,'%SALE_LINE_NOT_FOUND%','the public return command still works for people');
select throws_ok($$update shopify_refunds set amount_ore=0 where tenant_id=current_setting('test.tenant')::uuid$$,'42501',null,'members cannot edit refund evidence');

-- Images.
select is(prepare_shopify_image(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item2')::uuid),null::jsonb,'an item without a reception photo has no image');
select throws_like($$select prepare_shopify_image(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item1')::uuid)$$,'%SHOPIFY_IMAGE_PRODUCT_REQUIRED%','the product must be synced first');
reset role;
-- The reception item is sold above; put it back on sale for the image path by using a fresh reception item.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000999","role":"authenticated"}';
select set_config('test.session2',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.photo2',gen_random_uuid()::text,true);
select set_config('test.path2',current_setting('test.tenant')||'/'||current_setting('test.session2')||'/'||current_setting('test.photo2')||'.jpg',true);
reset role;
insert into storage.objects(bucket_id,name) values('reception-photos',current_setting('test.path2'));
set local role authenticated;
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,0,jsonb_build_array(jsonb_build_object('id',current_setting('test.photo2'),'kind','photo','reference',current_setting('test.path2'),'observation',''),jsonb_build_object('id','f0000000-0000-4000-8000-000000000939','kind','price-evidence','reference','Staff','observation','Test appraisal')));
select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,1,null,current_setting('test.agreement')::uuid,jsonb_build_object('attributes',jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value','Test coat','sourceIds',jsonb_build_array(current_setting('test.photo2')),'certainty','observed')),'price',jsonb_build_object('currency','SEK','amount','200.00','rationale','Test','sourceIds',jsonb_build_array('f0000000-0000-4000-8000-000000000939'::text)),'questions','[]'::jsonb),now()+interval '1 day');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,'');
select set_config('test.item3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item3')::uuid,'reception_review',current_setting('test.session2')::uuid,1,20000);
select set_config('test.export3',prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item3')::uuid)::text,true);
select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export3')::uuid,'synced',null,'gid://shopify/Product/3','gid://shopify/ProductVariant/3',null);
select set_config('test.intent',gen_random_uuid()::text,true);
select set_config('test.claim',prepare_shopify_image(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,current_setting('test.item3')::uuid)::text,true);
select is(current_setting('test.claim')::jsonb->>'reference',current_setting('test.path2'),'the accepted photo is selected');
select is(current_setting('test.claim')::jsonb->>'productGid','gid://shopify/Product/3','the intent names the synced product');
select is((current_setting('test.claim')::jsonb->>'fresh')::boolean,true,'first claim is fresh');
select is((prepare_shopify_image(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item3')::uuid)->>'fresh')::boolean,false,'another request converges on the same intent');
select is(prepare_shopify_image(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item3')::uuid)->>'id',current_setting('test.intent'),'same intent id');
select is((select o->>'imageStatus' from jsonb_array_elements(shopify_product_status(current_setting('test.tenant')::uuid)) o where o->>'itemId'=current_setting('test.item3')),'pending','status shows the pending photo');
select throws_like($$select record_shopify_image_result(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'https://evil.example/x',null)$$,'%INVALID_INPUT%','a media id must be a Shopify gid');
select record_shopify_image_result(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,null,'SHOPIFY_UPLOAD_FAILED');
select is((select o->>'imageStatus' from jsonb_array_elements(shopify_product_status(current_setting('test.tenant')::uuid)) o where o->>'itemId'=current_setting('test.item3')),'failed','a failed attempt is visible');
select record_shopify_image_result(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'gid://shopify/MediaImage/9',null);
select is(prepare_shopify_image(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item3')::uuid)->>'mediaGid','gid://shopify/MediaImage/9','the media id is returned on later claims');
select lives_ok($$select record_shopify_image_result(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'gid://shopify/MediaImage/9',null)$$,'acknowledgement replay');
select throws_like($$select record_shopify_image_result(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'gid://shopify/MediaImage/10',null)$$,'%REQUEST_CONFLICT%','a media id is never replaced');
select is((select o->>'imageStatus' from jsonb_array_elements(shopify_product_status(current_setting('test.tenant')::uuid)) o where o->>'itemId'=current_setting('test.item3')),'synced','status shows the photo in Shopify');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000990','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000990","role":"authenticated"}';
select lives_ok($$select shopify_product_status(current_setting('test.tenant')::uuid)$$,'staff read product status');
select throws_ok($$select prepare_shopify_image(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item3')::uuid)$$,'42501',null,'staff cannot claim images');
select throws_ok($$update shopify_product_images set media_gid='x' where tenant_id=current_setting('test.tenant')::uuid$$,'42501',null,'members cannot edit image rows');
select * from finish();
rollback;
