begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000461','sale-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000462','sale-reader@example.test',now()),
 ('f0000000-0000-4000-8000-000000000463','sale-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Zettle test','zettle-catalog-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@sales.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
-- Consignment item from the bag path, store item from a purchase.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea market',15000,'Receipt 7',true)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000);
create temp view lines as select jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',25000),jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',25000)) as l;

select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select is(item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->'connections','[]'::jsonb,'no invented connection before setup');
select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"consignment_margin":0,"store_full":25}');
select enable_zettle_pull(current_setting('test.tenant')::uuid,gen_random_uuid());
reset role;
insert into shopify_connections(tenant_id,shop_domain,shop_name,currency,cipher,connected_by) values(current_setting('test.tenant')::uuid,'synthetic.myshopify.com','Synthetic','SEK','{"iv":"test","tag":"test","data":"test"}','f0000000-0000-4000-8000-000000000461');
set local role authenticated;
select is(jsonb_array_length(item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->'connections'),2,'two independent connections for one item');
select set_config('test.paypal',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.paypal')::uuid,'failed','ZETTLE_UPDATE_FAILED');
select set_config('test.shopify',prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.shopify')::uuid,'synced',null,'gid://shopify/Product/1','gid://shopify/ProductVariant/1','gid://shopify/InventoryItem/1');
select is(item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->'connections'->0->>'status','failed','PayPal failure remains its own status');
select is(item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->'connections'->1->>'status','synced','Shopify success remains visible beside failed PayPal');
select is(item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->'connections'->1->>'stockStatus',null,'Shopify product outcome is not a separate stock observation');
select is(items_search_page(current_setting('test.tenant')::uuid,'{"syncProvider":"shopify","syncStatus":"synced"}','title','asc',25,0)->>'total','1','combined provider and state search');
select is(items_search_page(current_setting('test.tenant')::uuid,'{"syncProvider":"shopify","syncStatus":"failed"}','title','asc',25,0)->>'total','0','never match provider on one connection and failure on another');
select is(items_search_page(current_setting('test.tenant')::uuid,'{"syncStatus":"failed"}','title','asc',25,0)->>'total','1','any system failure search');
select is(items_search_page(current_setting('test.tenant')::uuid,'{"syncProvider":"shopify"}','title','asc',25,0)->>'total','2','connected but not yet exported items included');
select is(jsonb_array_length(items_search_page(current_setting('test.tenant')::uuid,'{}','title','asc',25,0)->'items'->0->'sync'),2,'directory carries every connection');
select throws_like($$select items_search_page(current_setting('test.tenant')::uuid,'{"syncProvider":"invented"}','title','asc',25,0)$$,'%INVALID_INPUT%','unknown provider rejected');
select throws_like($$select item_sync_status(current_setting('test.tenant')::uuid,array_fill(gen_random_uuid(),array[51]))$$,'%INVALID_INPUT%','bounded batch');
select is(jsonb_array_length(item_sync_status(current_setting('test.tenant')::uuid,array[gen_random_uuid()])),0,'unknown item excluded');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000462','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000462","role":"authenticated"}';
select is(jsonb_array_length(item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->'connections'),2,'readonly sees safe status for both connections');
select throws_like($$select komisio_private.item_sync_snapshot(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)$$,'%permission denied%','private snapshot cannot bypass checks');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select throws_like($$select item_sync_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])$$,'%FORBIDDEN%','outsider blocked');
select * from finish();
rollback;
