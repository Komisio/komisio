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

select throws_like($$select prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)$$,'%ZETTLE_VAT_MAPPING_REQUIRED%','no invented POS VAT mapping');
select set_config('test.config',gen_random_uuid()::text,true);
select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,current_setting('test.config')::uuid,null,'{"consignment_margin":0,"store_full":25}');
select is(publish_zettle_catalog_config(current_setting('test.tenant')::uuid,current_setting('test.config')::uuid,null,'{"consignment_margin":0,"store_full":25}'),current_setting('test.config')::uuid,'configuration replay');
select set_config('test.job',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);

select set_config('test.merchant',gen_random_uuid()::text,true);
select enable_zettle_pull(current_setting('test.tenant')::uuid,current_setting('test.merchant')::uuid);
select set_config('test.locations',jsonb_build_object('STORE',gen_random_uuid(),'SUPPLIER',gen_random_uuid(),'SOLD',gen_random_uuid(),'BIN',gen_random_uuid())::text,true);
select set_config('test.intent',gen_random_uuid()::text,true);
select is((claim_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)->>'fresh')::boolean,true,'first committed claim alone permits initial movement');
select is((claim_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)->>'fresh')::boolean,false,'same request never grants movement again');
select is((claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)->>'fresh')::boolean,false,'new request does not replenish the item');
select is((select count(*) from zettle_stock_intents),1::bigint,'one lifetime initial intent');
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,gen_random_uuid(),current_setting('test.locations')::jsonb)$$,'%ZETTLE_WRONG_MERCHANT%','wrong merchant denied');
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb||jsonb_build_object('STORE',gen_random_uuid()))$$,'%ZETTLE_INVENTORY_CONFLICT%','locations pinned across retries');
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,'{}')$$,'%INVALID_INPUT%','incomplete locations rejected');
select lives_ok($$select finish_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'unknown','ZETTLE_INVENTORY_FAILED')$$,'uncertain movement is durable');
select lives_ok($$select finish_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'initialized',null)$$,'read-back may resolve uncertainty');
select lives_ok($$select finish_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'initialized',null)$$,'identical outcome replay');
select is((select count(*) from zettle_stock_outcomes),2::bigint,'append-only outcomes preserve uncertainty without duplicate replay');
select is((select status from zettle_stock_status(current_setting('test.tenant')::uuid)),'initialized','latest result visible');
select throws_like($$update zettle_stock_intents set locations='{}'$$,'%permission denied%','no direct intent update');
select throws_like($$insert into zettle_stock_outcomes(tenant_id,intent_id,status,created_by) values(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'initialized',auth.uid())$$,'%permission denied%','no direct outcome write');
select set_config('test.job2',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid)::text,true);
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,current_setting('test.job2')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)$$,'%REQUEST_CONFLICT%','request cannot be repurposed for another item');
select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.config')::uuid,'{"consignment_margin":25,"store_full":25}');
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)$$,'%ZETTLE_CONFIG_CHANGED%','SQL rejects an outdated export snapshot');
select set_config('test.job',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select is((claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)->>'fresh')::boolean,false,'updated export still cannot replenish initial stock');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job')::uuid,'synced',null);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','stock-test',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',25000)));
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)$$,'%ITEM_ALREADY_SOLD%','sold item cannot acquire or replay a write claim');
reset role;
select throws_like($$delete from zettle_stock_intents$$,'%IMMUTABLE_ZETTLE%','even privileged deletion is refused');
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000462','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000462","role":"authenticated"}';
select throws_like($$select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.job2')::uuid,current_setting('test.merchant')::uuid,current_setting('test.locations')::jsonb)$$,'%FORBIDDEN%','staff cannot initialize pilot stock');
select throws_like($$select finish_zettle_stock(current_setting('test.tenant')::uuid,current_setting('test.intent')::uuid,'initialized',null)$$,'%FORBIDDEN%','staff cannot acknowledge stock');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select is((select count(*) from zettle_stock_intents),0::bigint,'outsider cannot read intents');
select is((select count(*) from zettle_stock_outcomes),0::bigint,'outsider cannot read outcomes');
select throws_like($$select zettle_stock_status(current_setting('test.tenant')::uuid)$$,'%FORBIDDEN%','outsider cannot enumerate status');
select * from finish();
rollback;
