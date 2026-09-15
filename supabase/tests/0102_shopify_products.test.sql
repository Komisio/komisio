begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000993','shopify-product-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000994','shopify-product-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000993","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Shopify products','shopify-products-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@shopify.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);
select set_config('test.cipher','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',true);

-- Nothing leaves before a shop is connected.
select throws_like($$select prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)$$,'%SHOPIFY_NOT_CONNECTED%','no export without a connection');
select is(jsonb_array_length(shopify_product_candidates(current_setting('test.tenant')::uuid)),1,'candidates are read from the catalog side, connection or not');
select store_shopify_connection(current_setting('test.tenant')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK',current_setting('test.cipher')::jsonb,'write_products',now()+interval '1 hour');
select is(jsonb_array_length(shopify_product_candidates(current_setting('test.tenant')::uuid)),1,'the accepted item is a candidate');
select is((shopify_product_candidates(current_setting('test.tenant')::uuid)->0->>'exportedBefore')::boolean,false,'never exported');
select is((shopify_product_candidates(current_setting('test.tenant')::uuid)->0->>'priceOre')::bigint,25000::bigint,'candidate carries the current price');

-- Prepare records the payload once per item and price.
select set_config('test.export',prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select is(prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid),current_setting('test.export')::uuid,'replay returns the same export');
select is((select payload->>'sku' from shopify_product_exports where id=current_setting('test.export')::uuid),'K-'||current_setting('test.item1'),'sku is the item id');
select is((select payload->>'price' from shopify_product_exports where id=current_setting('test.export')::uuid),'250.00','price in major units with two decimals');
select is((select payload->>'title' from shopify_product_exports where id=current_setting('test.export')::uuid),'Synthetic jacket','title from the draft');
select is((select (payload->>'quantity')::int from shopify_product_exports where id=current_setting('test.export')::uuid),1,'one unit');
select is((select product_gid from shopify_product_exports where id=current_setting('test.export')::uuid),null,'no product known yet');
select is(shopify_product_status(current_setting('test.tenant')::uuid)->0->>'status','pending','pending until an outcome is recorded');
select throws_like($$select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export')::uuid,'synced',null,null,null,null)$$,'%INVALID_INPUT%','synced needs the Shopify ids');
select throws_like($$select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export')::uuid,'failed',null,null,null,null)$$,'%INVALID_INPUT%','failed needs a code');
select throws_like($$select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export')::uuid,'failed','oops',null,null,null)$$,'%INVALID_INPUT%','codes are fixed');
select set_config('test.outcome',finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export')::uuid,'synced',null,'gid://shopify/Product/1','gid://shopify/ProductVariant/1','gid://shopify/InventoryItem/1')::text,true);
select is(finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export')::uuid,'synced',null,'gid://shopify/Product/1','gid://shopify/ProductVariant/1','gid://shopify/InventoryItem/1'),current_setting('test.outcome')::uuid,'same outcome is not recorded twice');
select is(shopify_product_status(current_setting('test.tenant')::uuid)->0->>'status','synced','status shows synced');
select is(shopify_product_status(current_setting('test.tenant')::uuid)->0->>'productGid','gid://shopify/Product/1','status carries the product');
select is(shopify_product_candidates(current_setting('test.tenant')::uuid),'[]'::jsonb,'a synced item at its current price is no candidate');
select throws_ok($$update shopify_product_outcomes set status='failed' where id=current_setting('test.outcome')::uuid$$,'42501',null,'outcomes are not updated by members');
select throws_ok($$delete from shopify_product_exports where id=current_setting('test.export')::uuid$$,'42501',null,'exports are not deleted by members');
reset role;
select throws_ok($$update shopify_product_outcomes set status='failed' where id=current_setting('test.outcome')::uuid$$,'55000',null,'outcomes are immutable even for the owner role');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000993","role":"authenticated"}';

-- A markdown is a new export for the same product.
select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item1')::uuid,20000,'Synthetic markdown');
select is((shopify_product_candidates(current_setting('test.tenant')::uuid)->0->>'exportedBefore')::boolean,true,'the marked-down item is a candidate again');
select set_config('test.export2',prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select isnt(current_setting('test.export2')::uuid,current_setting('test.export')::uuid,'new price, new export');
select is((select payload->>'price' from shopify_product_exports where id=current_setting('test.export2')::uuid),'200.00','new price recorded');
select is((select product_gid from shopify_product_exports where id=current_setting('test.export2')::uuid),'gid://shopify/Product/1','the known product is carried so the update names it');
select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export2')::uuid,'unknown','SHOPIFY_OUTCOME_UNKNOWN',null,null,null);
select is(shopify_product_status(current_setting('test.tenant')::uuid)->0->>'status','unknown','status shows the lost answer');
select is(jsonb_array_length(shopify_product_status(current_setting('test.tenant')::uuid)),1,'one row per item');
select is(jsonb_array_length(shopify_product_candidates(current_setting('test.tenant')::uuid)),1,'still a candidate until synced');

-- Token renewal is bound to the connection revision.
select set_config('test.revision',read_shopify_connection(current_setting('test.tenant')::uuid)->>'revision',true);
select is(refresh_shopify_tokens(current_setting('test.tenant')::uuid,current_setting('test.revision')::bigint+1,'{"iv":"aWl2","tag":"dGFn","data":"bmV3"}'::jsonb,'write_products',now()+interval '1 hour')->>'error','SHOPIFY_CONNECTION_CHANGED','stale revision is refused');
select is(read_shopify_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','ZGF0YQ==','refused renewal leaves the token');
select is(refresh_shopify_tokens(current_setting('test.tenant')::uuid,current_setting('test.revision')::bigint,'{"iv":"aWl2","tag":"dGFn","data":"bmV3"}'::jsonb,'write_products',now()+interval '1 hour')->>'status','refreshed','current revision renews');
select is(read_shopify_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','bmV3','new token stored');
select isnt(read_shopify_connection(current_setting('test.tenant')::uuid)->>'revision',current_setting('test.revision'),'revision moved');
select is((select count(*) from shopify_connection_events where tenant_id=current_setting('test.tenant')::uuid and kind in ('refused','refreshed')),2::bigint,'refusal and renewal recorded');

-- Staff read, never export.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000994','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000994","role":"authenticated"}';
select is(jsonb_array_length(shopify_product_status(current_setting('test.tenant')::uuid)),1,'staff see export status');
select throws_ok($$select prepare_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)$$,'42501',null,'staff cannot prepare');
select throws_ok($$select finish_shopify_product(current_setting('test.tenant')::uuid,current_setting('test.export2')::uuid,'failed','SHOPIFY_EXPORT_FAILED',null,null,null)$$,'42501',null,'staff cannot record outcomes');
select throws_ok($$select refresh_shopify_tokens(current_setting('test.tenant')::uuid,1,'{"iv":"aWl2","tag":"dGFn","data":"bmV3"}'::jsonb,'',now())$$,'42501',null,'staff cannot renew tokens');
select * from finish();
rollback;
