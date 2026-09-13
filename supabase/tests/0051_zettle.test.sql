begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000451','sale-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000452','sale-reader@example.test',now()),
 ('f0000000-0000-4000-8000-000000000453','sale-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000451","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Zettle test','zettle-test',gen_random_uuid())::text,true);
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
create temp view receipt as select jsonb_build_object('externalId','12345678-1234-4234-8234-123456789abc','occurredAt','2026-09-10T10:00:00Z','currency','SEK','amountOre',50000,'blockedReason',null,'lines',jsonb_build_array(
 jsonb_build_object('lineNo',1,'reference','I-'||upper(left(current_setting('test.item1'),8)),'labelConflict',false,'description','Jacket','priceOre',25000),
 jsonb_build_object('lineNo',2,'reference',null,'labelConflict',false,'description','Bag','priceOre',25000))) p;
select set_config('test.run',gen_random_uuid()::text,true);
select is(record_zettle_page(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid,null,'page-1',jsonb_build_array((select p from receipt))),current_setting('test.run')::uuid,'page imports');
select is(record_zettle_page(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid,null,'page-1',jsonb_build_array((select p from receipt))),current_setting('test.run')::uuid,'lost success replays');
select is((select count(*) from zettle_imports),1::bigint,'one receipt');
select is((select count(*) from unmatched_sale_lines),1::bigint,'missing label held');
select is((select count(*) from sales),0::bigint,'import creates no sale');
select is((select count(*) from seller_ledger_entries),0::bigint,'import creates no credit');
select set_config('test.import',(select id::text from zettle_imports),true);
create temp view payload as select jsonb_build_object('importId',current_setting('test.import'),'mappingRevision',coalesce((select max(revision) from zettle_line_resolutions),0)) p;
select is(reconcile_zettle_receipt(current_setting('test.tenant')::uuid,current_setting('test.import')::uuid),null::uuid,'unmatched receipt waits without partial sale');
select throws_like($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'page-2','[]')$$,'%ZETTLE_CURSOR_CHANGED%','stale cursor rejected');
select throws_like($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'page-1','page-2',jsonb_build_array((select p from receipt)||'{"amountOre":50001}'))$$,'%INVALID_INPUT%','receipt totals rechecked in SQL');
select throws_like($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'page-1','page-2',jsonb_build_array((select p from receipt)||'{"occurredAt":"2026-09-09T10:00:00Z"}'))$$,'%ZETTLE_PURCHASE_CONFLICT%','receipt identity cannot change contents');
select set_config('test.resolve',gen_random_uuid()::text,true);
select is(resolve_zettle_line(current_setting('test.tenant')::uuid,current_setting('test.resolve')::uuid,current_setting('test.import')::uuid,2,1,current_setting('test.item2')::uuid),current_setting('test.resolve')::uuid,'manual mapping');
select is(resolve_zettle_line(current_setting('test.tenant')::uuid,current_setting('test.resolve')::uuid,current_setting('test.import')::uuid,2,1,current_setting('test.item2')::uuid),current_setting('test.resolve')::uuid,'mapping replays');
select throws_like($$select resolve_zettle_line(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.import')::uuid,2,1,current_setting('test.item2')::uuid)$$,'%ZETTLE_ALREADY_RECORDED%','recorded matching is frozen');
select is((select count(*) from sales),1::bigint,'last match records complete checkout automatically');
select is((select count(*) from sale_lines),2::bigint,'whole receipt recorded atomically');
select is((select provider from sales),'zettle','provider retained');
select is((select sum(amount_ore) from seller_ledger_entries),10000::numeric,'engine computes seller credit once');
select is((select count(*) from pending_operations),0::bigint,'POS facts do not become AI proposals');
select reconcile_zettle_receipt(current_setting('test.tenant')::uuid,current_setting('test.import')::uuid);
select is((select count(*) from sales),1::bigint,'reconciliation replay cannot duplicate sale');
select is((select count(*) from seller_ledger_entries),1::bigint,'reconciliation replay cannot double credit');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000452','staff');
set local role authenticated;
select throws_like($$select resolve_zettle_line(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.import')::uuid,2,3,current_setting('test.item2')::uuid)$$,'%ZETTLE_ALREADY_RECORDED%','recorded mapping frozen');
select throws_ok($$update zettle_imports set amount_ore=1$$,'42501',null,'direct import update denied');
select throws_ok($$delete from zettle_line_resolutions$$,'42501',null,'direct mapping delete denied');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000453","role":"authenticated"}';
select is((select count(*) from zettle_imports),0::bigint,'outsider cannot read receipts');
select is((select count(*) from zettle_line_resolutions),0::bigint,'outsider cannot read mappings');
select is((select count(*) from zettle_sync_runs),0::bigint,'outsider cannot read cursor');
select throws_ok($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'page-1','page-1','[]')$$,'42501',null,'outsider cannot import');
select throws_ok($$select resolve_zettle_line(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.import')::uuid,1,3,current_setting('test.item1')::uuid)$$,'42501',null,'outsider cannot resolve');
reset role;
select throws_like($$update zettle_imports set amount_ore=1$$,'%IMMUTABLE_ZETTLE%','privileged edits also refused');
update tenant_members set role='readonly' where user_id='f0000000-0000-4000-8000-000000000452';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000452","role":"authenticated"}';
select is((select count(*) from zettle_imports),1::bigint,'reader sees receipts');
select throws_ok($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'page-1','page-1','[]')$$,'42501',null,'reader cannot import');
-- Unsupported receipts remain evidence and cannot be proposed.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000451","role":"authenticated"}';
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'page-1','blocked-page',jsonb_build_array((select p from receipt)||'{"externalId":"12345678-1234-4234-8234-123456789abd","blockedReason":"discount"}'));
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'recordZettlePurchase',jsonb_build_object('importId',(select id from zettle_imports where blocked_reason='discount'),'mappingRevision',1),'zettle-fixture',now()+interval '1 day')$$,'%ZETTLE_UNSUPPORTED_PURCHASE%','unsupported financial semantics cannot enter sale');
-- Deliberate short label collision: never guess the matching item.
select accept_item(current_setting('test.tenant')::uuid,'abcdef00-0000-4000-8000-000000000001','purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Test',100,'Test receipt',false),null,200);
select accept_item(current_setting('test.tenant')::uuid,'abcdef00-0000-4000-8000-000000000002','purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Test',100,'Test receipt 2',false),null,200);
select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'blocked-page','collision-page',jsonb_build_array(jsonb_build_object('externalId','12345678-1234-4234-8234-123456789abe','occurredAt','2026-09-10T10:00:00Z','currency','SEK','amountOre',200,'blockedReason',null,'lines',jsonb_build_array(jsonb_build_object('lineNo',1,'reference','I-ABCDEF00','labelConflict',false,'description','Collision','priceOre',200)))));
select is((select count(*) from unmatched_sale_lines where reason='ambiguous_label'),1::bigint,'ambiguous short label requires staff matching');
select set_config('test.collision',(select id::text from zettle_imports where external_id='12345678-1234-4234-8234-123456789abe'),true);
select is((select count(*) from zettle_line_resolutions where import_id=current_setting('test.collision')::uuid),0::bigint,'no arbitrary first matching item');
select resolve_zettle_line(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.collision')::uuid,1,0,'abcdef00-0000-4000-8000-000000000001');
select is((select count(*) from sales where external_id='12345678-1234-4234-8234-123456789abe'),1::bigint,'explicit collision resolution imports sale automatically');
-- A real foreign item still cannot be mapped, including by a member of both stores.
select set_config('test.foreign',create_tenant('Other Zettle store','other-zettle-test',gen_random_uuid())::text,true);
select accept_item(current_setting('test.foreign')::uuid,'abcdef00-0000-4000-8000-000000000003','purchase',register_purchase(current_setting('test.foreign')::uuid,gen_random_uuid(),'Test',100,'Foreign test receipt',false),null,200);
select throws_like($$select resolve_zettle_line(current_setting('test.tenant')::uuid,gen_random_uuid(),(select id from zettle_imports where blocked_reason='discount'),1,1,'abcdef00-0000-4000-8000-000000000003')$$,'%ITEM_NOT_FOUND%','cannot map item from another store');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000451','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000451","role":"authenticated","aal":"aal1"}';
select is((select count(*) from zettle_imports),0::bigint,'MFA enforced on read');
select throws_ok($$select record_zettle_page(current_setting('test.tenant')::uuid,gen_random_uuid(),'page-1','page-1','[]')$$,'42501',null,'MFA enforced on write');
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000452","role":"authenticated"}';
select is((select count(*) from zettle_matches(current_setting('test.tenant')::uuid,current_setting('test.import')::uuid,1)),1::bigint,'historical mapping preserves original review');
select is((select count(*) from zettle_matches(current_setting('test.tenant')::uuid,current_setting('test.import')::uuid,null)),2::bigint,'current mapping has latest per line');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000453","role":"authenticated"}';
select throws_ok($$select * from zettle_matches(current_setting('test.tenant')::uuid,current_setting('test.import')::uuid,null)$$,'42501',null,'projection refuses outsider');
select * from finish();
rollback;
