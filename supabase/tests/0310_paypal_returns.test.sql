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


select publish_zettle_catalog_config(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"consignment_margin":0,"store_full":25}');
select prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid);
select prepare_zettle_product(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid);
select set_config('test.original',gen_random_uuid()::text,true);
select set_config('test.refund',gen_random_uuid()::text,true);
select set_config('test.line1',(select jsonb_build_object('lineNo',1,'reference',null,'labelConflict',false,'description','Synthetic consignment','priceOre',25000,'productUuid',product_id,'variantUuid',variant_id)::text from zettle_product_exports where tenant_id=current_setting('test.tenant')::uuid and item_id=current_setting('test.item1')::uuid limit 1),true);
select set_config('test.line2',(select jsonb_build_object('lineNo',2,'reference',null,'labelConflict',false,'description','Synthetic owned','priceOre',25000,'productUuid',product_id,'variantUuid',variant_id)::text from zettle_product_exports where tenant_id=current_setting('test.tenant')::uuid and item_id=current_setting('test.item2')::uuid limit 1),true);
select set_config('test.originalFacts',jsonb_build_object('externalId',current_setting('test.original'),'occurredAt','2026-09-13T10:00:00Z','currency','SEK','amountOre',50000,'blockedReason',null,'lines',jsonb_build_array(current_setting('test.line1')::jsonb,current_setting('test.line2')::jsonb))::text,true);
select set_config('test.refundFacts',jsonb_build_object('externalId',current_setting('test.refund'),'refundOf',current_setting('test.original'),'occurredAt','2026-09-14T10:00:00Z','currency','SEK','amountOre',-25000,'blockedReason','refund','lines',jsonb_build_array(current_setting('test.line1')::jsonb))::text,true);
-- Simulate the legacy mapper seeing an already-refunded original sale.
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'one',jsonb_build_array(current_setting('test.originalFacts')::jsonb||'{"blockedReason":"refund"}'));
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'one','two',jsonb_build_array(current_setting('test.refundFacts')::jsonb));
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'refund waits for recorded original sale');
select is((select error_code from zettle_receipt_outcomes where tenant_id=current_setting('test.tenant')::uuid and import_id=(select id from zettle_imports where tenant_id=current_setting('test.tenant')::uuid and external_id=current_setting('test.refund')::uuid) order by created_at desc,id desc limit 1),'ZETTLE_ORIGINAL_SALE_REQUIRED','missing original has a specific held reason');
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'two','three',jsonb_build_array(current_setting('test.originalFacts')::jsonb));
select is((select count(*) from sales where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'fresh original classification records sale once');
select is((select blocked_reason from zettle_imports where tenant_id=current_setting('test.tenant')::uuid and external_id=current_setting('test.original')::uuid),'refund','legacy evidence was not overwritten');
select is((select count(*) from zettle_receipt_classifications where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'sale correction and refund linkage are new evidence rows');
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'pending refund reconciles when original arrives');
select is((select sum(amount_ore) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid),0::numeric,'seller sale credit reversed exactly once');
select is((select count(*) from zettle_stock_intents where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'return ingestion creates no POS stock mutation');
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'three','four',jsonb_build_array(current_setting('test.refundFacts')::jsonb));
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'duplicate refund cannot return twice');
select is((select count(*) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid and kind='credit_reversal'),1::bigint,'duplicate cannot reverse credit twice');
-- Owned line first; the already-returned second line forces all return writes to roll back.
select set_config('test.duplicate',gen_random_uuid()::text,true);
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'four','five',jsonb_build_array(current_setting('test.refundFacts')::jsonb||jsonb_build_object('externalId',current_setting('test.duplicate'),'amountOre',-50000,'lines',jsonb_build_array(current_setting('test.line2')::jsonb||'{"lineNo":1}',current_setting('test.line1')::jsonb||'{"lineNo":2}'))));
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'whole refund is atomic when one line cannot be returned');
select is((select error_code from zettle_receipt_outcomes where tenant_id=current_setting('test.tenant')::uuid and import_id=(select id from zettle_imports where tenant_id=current_setting('test.tenant')::uuid and external_id=current_setting('test.duplicate')::uuid) order by created_at desc,id desc limit 1),'LINE_ALREADY_RETURNED','duplicate line stays held');
select set_config('test.partial',gen_random_uuid()::text,true);
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'five','six',jsonb_build_array(current_setting('test.refundFacts')::jsonb||jsonb_build_object('externalId',current_setting('test.partial'),'amountOre',-10000,'lines',jsonb_build_array(current_setting('test.line2')::jsonb||'{"lineNo":1,"priceOre":10000}'))));
select is((select error_code from zettle_receipt_outcomes where tenant_id=current_setting('test.tenant')::uuid and import_id=(select id from zettle_imports where tenant_id=current_setting('test.tenant')::uuid and external_id=current_setting('test.partial')::uuid) order by created_at desc,id desc limit 1),'PARTIAL_REFUND_UNSUPPORTED','partial value does not become a whole-item return');
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'partial value changes no stock or ledger');
select throws_like($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'six','seven',jsonb_build_array(current_setting('test.refundFacts')::jsonb||jsonb_build_object('refundOf',gen_random_uuid())))$$,'%ZETTLE_PURCHASE_CONFLICT%','refund original cannot be changed on replay');
select throws_like($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'six','seven',jsonb_build_array(current_setting('test.refundFacts')::jsonb||'{"amountOre":25000}'))$$,'%INVALID_INPUT%','SQL independently rejects invalid refund sum');
select throws_like($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'six','seven',jsonb_build_array(current_setting('test.refundFacts')::jsonb||jsonb_build_object('lines',jsonb_build_array(current_setting('test.line1')::jsonb-'productUuid'))))$$,'%INVALID_INPUT%','SQL independently requires complete provider identity');
select is((select cardinality(return_ids) from zettle_receipt_outcomes where tenant_id=current_setting('test.tenant')::uuid and return_ids is not null limit 1),1,'outcome retains exact return identity');
-- The real pull entry point records the remaining owned-item return under an accepted worker identity.
select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'zettle_pull','refund-bot@example.test');
select set_config('test.merchant',gen_random_uuid()::text,true);
select set_config('test.window',gen_random_uuid()::text,true);
reset role;
insert into auth.users(id,email,email_confirmed_at) values('f0000000-0000-4000-8000-000000000464','refund-bot@example.test',now());
insert into zettle_pull_connections(tenant_id,merchant_id,cutover,created_by) values(current_setting('test.tenant')::uuid,current_setting('test.merchant')::uuid,'2026-09-14T00:00:00Z','f0000000-0000-4000-8000-000000000461');
insert into zettle_pull_windows(id,tenant_id,merchant_id,start_at,end_at,created_by) values(current_setting('test.window')::uuid,current_setting('test.tenant')::uuid,current_setting('test.merchant')::uuid,'2026-09-14T00:00:00Z','2026-09-15T00:00:00Z','f0000000-0000-4000-8000-000000000461');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000464","role":"authenticated"}';
select accept_automation_grants();
select lives_ok($$select record_zettle_pull_page(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.window')::uuid,null,'refund-page',jsonb_build_array(current_setting('test.refundFacts')::jsonb||jsonb_build_object('externalId',gen_random_uuid(),'lines',jsonb_build_array(current_setting('test.line2')::jsonb||'{"lineNo":1}'))))$$,'accepted worker imports a verified refund through the real pull boundary');
reset role;
select is((select count(*) from sale_returns where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'worker records owned-item return');
select is((select recorded_by from sale_returns where tenant_id=current_setting('test.tenant')::uuid and item_id=current_setting('test.item2')::uuid),'f0000000-0000-4000-8000-000000000464'::uuid,'return identifies actual automation actor');
select ok(komisio_private.item_lifecycle(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid)->>'stage'<>'sold','returned owned item leaves sold state');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select disable_automation(current_setting('test.tenant')::uuid,'zettle_pull');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000464","role":"authenticated"}';
select throws_like($$select record_zettle_pull_page(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.window')::uuid,'refund-page','later',jsonb_build_array(current_setting('test.refundFacts')::jsonb))$$,'%FORBIDDEN%','revoked worker cannot import more financial facts');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select throws_like($$delete from zettle_receipt_classifications$$,'%permission denied%','classification evidence cannot be changed directly');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select throws_like($$select zettle_return_status(current_setting('test.tenant')::uuid,array[gen_random_uuid()])$$,'%FORBIDDEN%','outsider cannot read return linkage');
select throws_like($$select komisio_private.reconcile_zettle_refund(current_setting('test.tenant')::uuid,gen_random_uuid())$$,'%permission denied%','private return operation has no direct API');
reset role;
select ok(komisio_private.valid_zettle_purchase(current_setting('test.originalFacts')::jsonb||'{"currency":"USD"}'),'normal receipts retain USD support');
select ok(komisio_private.valid_zettle_purchase(current_setting('test.refundFacts')::jsonb||'{"currency":"USD"}'),'refund receipts retain USD support');
select * from finish();rollback;
