begin;
\ir bag-reception-fixture.inc
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
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'reception_review',current_setting('test.draft')::uuid,1,25000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea market',15000,'Receipt 7',true)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000);
create temp view lines as select jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',25000),jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',25000)) as l;

select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select is(paypal_item_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->>'status','attention','missing mapping needs attention before any export');
select is(jsonb_array_length(paypal_item_status(current_setting('test.tenant')::uuid,array[gen_random_uuid()])),0,'unknown item omitted');
select set_config('test.config',gen_random_uuid()::text,true);
select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,current_setting('test.config')::uuid,null,'{"consignment_margin":0,"store_full":25}');
select set_config('test.job',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job')::uuid,'synced',null);
select is(paypal_item_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->>'status','attention','product acknowledgement without stock is not full sync');
select set_config('test.merchant',gen_random_uuid()::text,true);
select enable_zettle_pull(current_setting('test.tenant')::uuid,current_setting('test.merchant')::uuid);
select set_config('test.locations',jsonb_build_object('STORE',gen_random_uuid(),'SUPPLIER',gen_random_uuid(),'SOLD',gen_random_uuid(),'BIN',gen_random_uuid())::text,true);
select set_config('test.intent',gen_random_uuid()::text,true);
select claim_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb);
select finish_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'initialized',null);
select is(paypal_item_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->>'status','synced','current product and confirmed stock');

-- Correcting an accepted description must invalidate the old export without changing stock.
select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item1')::uuid,'description','Red sweater','Description corrected');
select is(paypal_item_status(current_setting('test.tenant')::uuid,array[current_setting('test.item1')::uuid])->0->>'status','changed','title change is visible before export');
select ok(exists(select 1 from zettle_catalog_candidates(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item1')::uuid),'title correction is a sync candidate');
select set_config('test.job2',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select isnt(current_setting('test.job2'),current_setting('test.job'),'changed description creates a new snapshot');
select is(prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,current_setting('test.job2'),'title export replay converges');
select is((select payload->>'name' from zettle_product_exports where id=current_setting('test.job2')::uuid),'Red sweater','current title is exported');
select is((select payload->>'name' from zettle_product_exports where id=current_setting('test.job')::uuid),'Synthetic jacket','old snapshot stays immutable');
select is((select previous_payload->>'name' from zettle_product_exports where id=current_setting('test.job2')::uuid),'Synthetic jacket','previous acknowledged title protects external edits');
select is((select count(distinct product_id) from zettle_product_exports where item_id=current_setting('test.item1')::uuid),1::bigint,'title correction retains remote product');
select is((select count(distinct variant_id) from zettle_product_exports where item_id=current_setting('test.item1')::uuid),1::bigint,'title correction retains remote variant');
select is((select count(distinct payload->'variants'->0->>'barcode') from zettle_product_exports where item_id=current_setting('test.item1')::uuid),1::bigint,'barcode stays stable');
select is(claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job2')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)->>'fresh','false','title correction cannot claim an extra unit');
select throws_like($$select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job')::uuid,'synced',null)$$,'%ZETTLE_EXPORT_STALE%','old title cannot be acknowledged');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job2')::uuid,'synced',null);
select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item1')::uuid,'description','Synthetic jacket','Revert description');
select set_config('test.job3',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select isnt(current_setting('test.job3'),current_setting('test.job'),'reverted title creates a new snapshot instead of replaying an old update');
select is((select previous_payload->>'name' from zettle_product_exports where id=current_setting('test.job3')::uuid),'Red sweater','reversion compares against last acknowledged remote title');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job3')::uuid,'synced',null);
select ok(not exists(select 1 from zettle_catalog_candidates(current_setting('test.tenant')::uuid) where item_id=current_setting('test.item1')::uuid),'acknowledged title no longer needs export');
-- Quick reception stores descriptions in attributes, not the retired metadata map.
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.quick',quick_receive(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Green shirt"}',13000)->>'itemId',true);
select set_config('test.quickjob',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.quick')::uuid)::text,true);
select is((select payload->>'name' from zettle_product_exports where id=current_setting('test.quickjob')::uuid),'Green shirt','quick reception title reaches POS');
select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.quick')::uuid,'description',repeat('Long title ',20),'Detailed description');
select set_config('test.quickjob',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.quick')::uuid)::text,true);
select is((select length(payload->>'name') from zettle_product_exports where id=current_setting('test.quickjob')::uuid),120,'POS title respects provider limit');
select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item2')::uuid,'description','Store-owned lamp','Record display title');
select set_config('test.storejob',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid)::text,true);
select is((select payload->>'name' from zettle_product_exports where id=current_setting('test.storejob')::uuid),'Store-owned lamp','store-owned title uses same descriptive read');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select throws_like($$select prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.quick')::uuid)$$,'%FORBIDDEN%','another tenant cannot prepare titles');
select throws_like($$select komisio_private.zettle_product_name(current_setting('test.tenant')::uuid,current_setting('test.quick')::uuid)$$,'%permission denied%','private name helper is not a public data bypass');
select * from finish();
rollback;
