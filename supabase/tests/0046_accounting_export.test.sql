begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000291','acct-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000292','acct-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000291","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Accounting test','accounting-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@acct.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,20000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',20000)));
select set_config('test.close',gen_random_uuid()::text,true);
select generate_day_close(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid,'2026-09-10');
-- Without a map: preview lists every non-zero amount as unmapped; export refused.
select set_config('test.pv',preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)::text,true);
select is(jsonb_array_length(current_setting('test.pv')::jsonb->'lines'),0,'no lines without a map');
select ok((current_setting('test.pv')::jsonb->'unmapped') ? 'grossOre','gross amount reported as unmapped');
select is((current_setting('test.pv')::jsonb->>'mapVersion')::int,0,'no map version yet');
select throws_like($$select export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid)$$,'%ACCOUNTING_MAP_REQUIRED%','export needs a map');
-- Map validation: only known keys, four-digit accounts, debit or credit.
select throws_like($$select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"grossOre":{"account":"19300","side":"debit"}}')$$,'%INVALID_INPUT%','account must be four digits');
select throws_like($$select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"profit":{"account":"1930","side":"debit"}}')$$,'%INVALID_INPUT%','unknown amount key refused');
select throws_like($$select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"grossOre":{"account":"1930","side":"both"}}')$$,'%INVALID_INPUT%','side must be debit or credit');
-- A map that does not balance for this day is published (it is the tenant's), but the export is refused.
select set_config('test.m1',gen_random_uuid()::text,true);
select is(publish_accounting_map(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,null,'{"grossOre":{"account":"1930","side":"debit"}}'),current_setting('test.m1')::uuid,'map published');
select is(publish_accounting_map(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,null,'{"grossOre":{"account":"1930","side":"debit"}}'),current_setting('test.m1')::uuid,'map replay');
select throws_like($$select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"grossOre":{"account":"1930","side":"debit"}}')$$,'%MAP_CHANGED%','a second publish must name the current map');
select is((current_accounting_map(current_setting('test.tenant')::uuid)->>'version')::int,1,'version one');
select set_config('test.pv',preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)::text,true);
select is((current_setting('test.pv')::jsonb->>'balanced')::boolean,false,'one-sided map does not balance');
select is((current_setting('test.pv')::jsonb->>'debitOre')::bigint,20000::bigint,'debit total shown');
select throws_like($$select export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid)$$,'%VOUCHER_UNBALANCED%','unbalanced voucher refused');
-- A balancing map as the tenant's accountant might set it: payments debit; seller liability, commission and VAT on commission credit.
select set_config('test.m2',gen_random_uuid()::text,true);
select publish_accounting_map(current_setting('test.tenant')::uuid,current_setting('test.m2')::uuid,current_setting('test.m1')::uuid,
 '{"grossOre":{"account":"1930","side":"debit"},"sellerCreditOre":{"account":"2890","side":"credit"},"commissionOre":{"account":"3010","side":"credit"},"commissionVatOre":{"account":"2610","side":"credit"}}');
select set_config('test.pv',preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)::text,true);
select is((current_setting('test.pv')::jsonb->>'balanced')::boolean,true,'balanced under the second map');
select is((current_setting('test.pv')::jsonb->>'mapVersion')::int,2,'preview uses the current map');
select is(current_setting('test.pv')::jsonb->>'exportId',null,'not exported yet');
-- Staff may export; the export is one row per day close and map version.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000292','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000292","role":"authenticated"}';
select throws_ok($$select publish_accounting_map(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.m2')::uuid,'{}')$$,'42501',null,'staff cannot publish the map');
select set_config('test.e1',gen_random_uuid()::text,true);
select is(export_day_close(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.close')::uuid),current_setting('test.e1')::uuid,'exported');
select is(export_day_close(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.close')::uuid),current_setting('test.e1')::uuid,'replay');
select is(export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid),current_setting('test.e1')::uuid,'a new request for the same close and map returns the same export');
select is((select debit_ore||'|'||credit_ore||'|'||jsonb_array_length(voucher) from accounting_exports where id=current_setting('test.e1')::uuid),'20000|20000|3','three balanced lines recorded: inclusive commission carries no separate VAT line');
select is((select voucher->0->>'account' from accounting_exports where id=current_setting('test.e1')::uuid),'1930','lines keep the tenant account numbers');
select is(preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)->>'exportId',current_setting('test.e1'),'preview links the export');
select throws_ok($$delete from accounting_exports where id=current_setting('test.e1')::uuid$$,'42501',null,'no direct deletes');
reset role;
select throws_ok($$update accounting_maps set map='{}' where id=current_setting('test.m2')::uuid$$,'55000',null,'maps are immutable even for the owner role');
select * from finish();
rollback;
