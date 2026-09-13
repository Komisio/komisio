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
select is(prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid),current_setting('test.job')::uuid,'retry uses same export');
select is((select (payload->'variants'->0->'price'->>'amount')::bigint from zettle_product_exports where id=current_setting('test.job')::uuid),25000::bigint,'exact engine price exported');
select is((select payload->>'vatPercentage' from zettle_product_exports where id=current_setting('test.job')::uuid),'0','explicit test POS VAT mapping, no legality inferred');
select is((select payload->>'name' from zettle_product_exports where id=current_setting('test.job')::uuid),'Synthetic jacket','accepted description comes from its frozen source');
select isnt((select product_id from zettle_product_exports where id=current_setting('test.job')::uuid),(select variant_id from zettle_product_exports where id=current_setting('test.job')::uuid),'distinct product and variant identifiers');
select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job')::uuid,'synced',null);
select is((select count(*) from zettle_catalog_candidates(current_setting('test.tenant')::uuid)),1::bigint,'delivered item no longer needs export');
select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item1')::uuid,24000,'Synthetic price change');
select set_config('test.job2',prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)::text,true);
select isnt(current_setting('test.job'),current_setting('test.job2'),'new price creates new immutable export');
select is((select previous_payload->'variants'->0->'price'->>'amount' from zettle_product_exports where id=current_setting('test.job2')::uuid),'25000','update carries previous acknowledged state for conflict checks');
select is((select count(distinct product_id) from zettle_product_exports where item_id=current_setting('test.item1')::uuid),1::bigint,'product identity stable across changes');
select throws_like($$select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job')::uuid,'synced',null)$$,'%ZETTLE_EXPORT_STALE%','old job cannot acknowledge a newer price');
select is((select count(*) from sales),0::bigint,'export never records sale');

select throws_like($$select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,current_setting('test.config')::uuid,gen_random_uuid(),'{"consignment_margin":0,"store_full":25}')$$,'%REQUEST_CONFLICT%','replay binds previous configuration');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"salePeriodDays":43}');
select isnt(prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid),current_setting('test.job2')::uuid,'policy changes create a fresh snapshot without rewriting history');
select set_config('test.receipt',gen_random_uuid()::text,true);
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'one',jsonb_build_array(jsonb_build_object('externalId',current_setting('test.receipt'),'occurredAt','2026-09-13T10:00:00Z','currency','SEK','amountOre',24000,'blockedReason',null,'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'reference',null,'labelConflict',false,'description','Known product identifiers','priceOre',24000,'productUuid',(select product_id from zettle_product_exports where id=current_setting('test.job')::uuid),'variantUuid',(select variant_id from zettle_product_exports where id=current_setting('test.job')::uuid))))));
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'product and variant pair records sale without label or second approver');
select is((select sum(amount_ore) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid),9600::numeric,'automatic sale credits agreed seller share once');
select is((select count(*) from pending_operations where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'verified checkout does not create an AI approval operation');
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'one','two',jsonb_build_array(jsonb_build_object('externalId',gen_random_uuid(),'occurredAt','2026-09-13T10:00:00Z','currency','SEK','amountOre',25000,'blockedReason',null,'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'reference','I-'||upper(left(current_setting('test.item2'),8)),'labelConflict',false,'description','Unknown product pair with a valid local label','priceOre',25000,'productUuid',gen_random_uuid(),'variantUuid',gen_random_uuid())))));
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'unknown pair cannot fall back to a valid local label');
select throws_like($$select prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)$$,'%ITEM_ALREADY_SOLD%','sold item cannot be exported');

select set_config('test.other',create_tenant('Other merchant','zettle-other-merchant',gen_random_uuid())::text,true);
select record_zettle_page(current_setting('test.other')::uuid,gen_random_uuid(),null,'one',jsonb_build_array(jsonb_build_object('externalId',gen_random_uuid(),'occurredAt','2026-09-13T10:00:00Z','currency','SEK','amountOre',24000,'blockedReason',null,'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'reference',null,'labelConflict',false,'description','Foreign exported pair','priceOre',24000,'productUuid',(select product_id from zettle_product_exports where id=current_setting('test.job')::uuid),'variantUuid',(select variant_id from zettle_product_exports where id=current_setting('test.job')::uuid))))));
select is((select count(*) from zettle_line_resolutions where tenant_id=current_setting('test.other')::uuid),0::bigint,'foreign product pair cannot match even for an owner of both stores');
select is((select count(*) from sales where tenant_id=current_setting('test.other')::uuid),0::bigint,'foreign product pair never creates a sale');
select throws_ok($$select prepare_zettle_product(current_setting('test.other')::uuid,current_setting('test.item2')::uuid)$$,'P0001','ITEM_NOT_FOUND','cross-tenant item export denied');
select throws_ok($$update zettle_product_exports set payload='{}'$$,'42501',null,'snapshot updates denied');
reset role;
select throws_like($$delete from zettle_product_exports$$,'%IMMUTABLE_ZETTLE%','privileged snapshot deletion denied');
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000462','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000462","role":"authenticated"}';
select throws_ok($$select prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid)$$,'42501',null,'readonly cannot export');
select throws_ok($$select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.config')::uuid,'{}')$$,'42501',null,'readonly cannot configure');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select is((select count(*) from zettle_product_exports),0::bigint,'outsider cannot read products');
select throws_ok($$select finish_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.job2')::uuid,'synced',null)$$,'42501',null,'outsider cannot acknowledge');
select * from finish();
rollback;
