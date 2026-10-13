begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000003131','inventory-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000003132','inventory-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003131","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Item import test','item-import-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','inventory@example.test','')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
select set_config('test.rows',jsonb_build_array(jsonb_build_object('reference','SOURCE-001','sellerId',current_setting('test.seller'),'email','inventory@example.test','description','Blue shirt','priceOre',15025,'currency','SEK'))::text,true);
select set_config('test.context',inventory_import_context(current_setting('test.tenant')::uuid,array[current_setting('test.seller')::uuid]),true);
select set_config('test.request',gen_random_uuid()::text,true);
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'preview creates no items');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),false)$$,'P0001','CUSTODY_REQUIRED','custody confirmation required');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb,'stale',true)$$,'P0001','IMPORT_CHANGED','stale terms refused');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb || jsonb_set(current_setting('test.rows')::jsonb,'{0,reference}','"SOURCE-002"') || '[{"reference":"bad"}]'::jsonb,current_setting('test.context'),true)$$,'P0001','INVALID_INPUT','malformed later row rolls back whole import');
select is((select count(*) from reception_sessions where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'failed batch leaves no sessions');
select set_config('test.result',import_inventory(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true)::text,true);
select is(current_setting('test.result')::jsonb->>'created','1','one item imported');
select is((select count(*) from garment_receipts where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'physical receipt recorded');
select is((select terms->>'commissionRatePercent' from items where tenant_id=current_setting('test.tenant')::uuid),'60','current commission frozen');
select is((select price_ore from item_prices where tenant_id=current_setting('test.tenant')::uuid),15025::bigint,'exact ore preserved');
select is(import_inventory(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true),current_setting('test.result')::jsonb,'lost response replays exact result');
select is(import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'renamed.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true)->>'skipped','1','source reference survives renamed file and request');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',jsonb_set(current_setting('test.rows')::jsonb,'{0,priceOre}','16000'),current_setting('test.context'),true)$$,'P0001','IMPORT_REFERENCE_CONFLICT','changed reference never overwrites price');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,'different.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true)$$,'P0001','REQUEST_CONFLICT','request payload immutable');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb || current_setting('test.rows')::jsonb,current_setting('test.context'),true)$$,'P0001','INVALID_INPUT','duplicate file references refused');
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'no duplicated inventory');
select set_config('test.policy',(current_store_policy(current_setting('test.tenant')::uuid)->>'id'),true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"agreementRequiredFor":["acceptance"]}'::jsonb);
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',jsonb_set(current_setting('test.rows')::jsonb,'{0,reference}','"SOURCE-002"'),inventory_import_context(current_setting('test.tenant')::uuid,array[current_setting('test.seller')::uuid]),true)$$,'P0001','AGREEMENT_REQUIRED','agreement guard remains authoritative');
select is(import_inventory(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true),current_setting('test.result')::jsonb,'successful replay survives later policy changes');
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic agreement','Terms','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Synthetic signed agreement');
select set_config('test.unapproved',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Unapproved synthetic seller','unapproved@example.test','')::text,true);
select set_config('test.mixed',(
 jsonb_set(current_setting('test.rows')::jsonb,'{0,reference}','"SOURCE-002"') ||
 jsonb_build_array(jsonb_build_object('reference','SOURCE-003','sellerId',current_setting('test.unapproved'),'email','','description','Coat','priceOre',20000,'currency','SEK'))
)::text,true);
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.mixed')::jsonb,inventory_import_context(current_setting('test.tenant')::uuid,array[current_setting('test.seller')::uuid,current_setting('test.unapproved')::uuid]),true)$$,'P0001','AGREEMENT_REQUIRED','later acceptance failure rolls back earlier valid item');
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'atomic batch does not retain earlier accepted rows');
select is((select count(*) from garment_receipts where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'atomic batch does not retain earlier custody facts');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',jsonb_set(current_setting('test.rows')::jsonb,'{0,currency}','"EUR"'),current_setting('test.context'),true)$$,'P0001','CURRENCY_MISMATCH','currency is checked in database');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',jsonb_set(current_setting('test.rows')::jsonb,'{0,priceOre}','1.5'),current_setting('test.context'),true)$$,'P0001','INVALID_INPUT','fractional ore refused');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',jsonb_set(current_setting('test.rows')::jsonb,'{0,sellerId}',to_jsonb(gen_random_uuid())),current_setting('test.context'),true)$$,'P0001','IMPORT_SELLER_CHANGED','unknown or foreign seller is not accepted');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',jsonb_set(current_setting('test.rows')::jsonb,'{0,email}','"changed@example.test"'),current_setting('test.context'),true)$$,'P0001','IMPORT_SELLER_CHANGED','changed seller lookup requires fresh preview');
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',(select jsonb_agg(current_setting('test.rows')::jsonb->0) from generate_series(1,201)),current_setting('test.context'),true)$$,'P0001','INVALID_INPUT','201 rows refused without truncating');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003132','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003132","role":"authenticated"}';
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true)$$,'42501','FORBIDDEN','staff denied');
select throws_ok($$select inventory_import_context(current_setting('test.tenant')::uuid,array[current_setting('test.seller')::uuid])$$,'42501','FORBIDDEN','staff cannot preview context');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000003131','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003131","role":"authenticated","aal":"aal1"}';
select throws_like($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true)$$,'%AUTH_REQUIRED%','MFA required');
set local role anon;
select throws_ok($$select import_inventory(current_setting('test.tenant')::uuid,gen_random_uuid(),'stock.csv',current_setting('test.rows')::jsonb,current_setting('test.context'),true)$$,'42501','permission denied for function import_inventory','anonymous denied');
reset role;
select * from finish();
rollback;
