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


select is((select substring(product_id::text,15,1) from zettle_product_exports where id=current_setting('test.job')::uuid),'1','new provider product uses v1');
select is((select substring(variant_id::text,15,1) from zettle_product_exports where id=current_setting('test.job')::uuid),'1','new variant uses v1');
-- Insert a historical v4 snapshot under the privileged fixture role; no trigger bypass.
reset role;
select set_config('test.legacy',gen_random_uuid()::text,true);
insert into zettle_product_exports(id,tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,created_by)
select current_setting('test.legacy')::uuid,tenant_id,item_id,price_id,config_id,policy_version,
 '10000000-0000-4000-8000-000000000071'::uuid,'10000000-0000-4000-8000-000000000072'::uuid,
 jsonb_set(jsonb_set(payload,'{uuid}','"10000000-0000-4000-8000-000000000071"'),'{variants,0,uuid}','"10000000-0000-4000-8000-000000000072"'),created_by
from zettle_product_exports where id=current_setting('test.job')::uuid;
set local role authenticated;
select throws_like($$select repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid)$$,'%ZETTLE_IDENTITY_HELD%','no recovery without a recorded pre-write UUID rejection');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid,'failed','ZETTLE_PRODUCT_UUID_REJECTED');
select set_config('test.fixed',repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid)::text,true);
select is(repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid),current_setting('test.fixed')::uuid,'recovery replay returns the same successor');
select is(prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid),current_setting('test.fixed')::uuid,'current snapshot resolves to successor');
select is((select substring(product_id::text,15,1) from zettle_product_exports where id=current_setting('test.fixed')::uuid),'1','recovered product uses v1');
select is((select product_id::text from zettle_product_exports where id=current_setting('test.legacy')::uuid),'10000000-0000-4000-8000-000000000071','old identity is unchanged');
select is((select supersedes_export_id from zettle_product_exports where id=current_setting('test.fixed')::uuid),current_setting('test.legacy')::uuid,'correction points to rejected evidence');
select throws_like($$select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid,'synced',null)$$,'%ZETTLE_EXPORT_STALE%','old identity cannot be acknowledged after correction');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.fixed')::uuid,'failed','ZETTLE_PRODUCT_UUID_REJECTED');
select throws_like($$select repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.fixed')::uuid)$$,'%ZETTLE_IDENTITY_HELD%','a v1 identity is never rotated');
select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.config')::uuid,'{"consignment_margin":25,"store_full":25}');
select set_config('test.next',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select is((select product_id from zettle_product_exports where id=current_setting('test.next')::uuid),(select product_id from zettle_product_exports where id=current_setting('test.fixed')::uuid),'later configuration retains corrected provider identity');
-- An acknowledged v4 fixture must remain held even if a later read reports rejection.
select set_config('test.second',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid)::text,true);
reset role;
select set_config('test.ack',gen_random_uuid()::text,true);
insert into zettle_product_exports(id,tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,created_by)
select current_setting('test.ack')::uuid,tenant_id,item_id,price_id,config_id,policy_version,gen_random_uuid(),gen_random_uuid(),payload,created_by
from zettle_product_exports where id=current_setting('test.second')::uuid;
set local role authenticated;
select set_config('test.merchant',gen_random_uuid()::text,true);
select enable_zettle_pull(current_setting('test.tenant')::uuid,current_setting('test.merchant')::uuid);
select claim_zettle_stock(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.ack')::uuid,current_setting('test.merchant')::uuid,jsonb_build_object('STORE',gen_random_uuid(),'SUPPLIER',gen_random_uuid(),'SOLD',gen_random_uuid(),'BIN',gen_random_uuid()));
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.ack')::uuid,'failed','ZETTLE_PRODUCT_UUID_REJECTED');
select throws_like($$select repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.ack')::uuid)$$,'%ZETTLE_IDENTITY_HELD%','even an unacknowledged product with a stock intent cannot be rotated');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.ack')::uuid,'synced',null);
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.ack')::uuid,'failed','ZETTLE_PRODUCT_UUID_REJECTED');
select throws_like($$select repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.ack')::uuid)$$,'%ZETTLE_IDENTITY_HELD%','ever-acknowledged product cannot be rotated');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000462','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000462","role":"authenticated"}';
select throws_like($$select repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid)$$,'%FORBIDDEN%','staff cannot recover identities');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select throws_like($$select repair_zettle_product_identity(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid)$$,'%FORBIDDEN%','outsider cannot recover or replay');
select * from finish();
rollback;
