begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000141','ledger-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000142','ledger-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000144','ledger-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000141","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Ledger test','ledger-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@ledger.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',15000,'Receipt 1',false)::text,true);
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'purchase',current_setting('test.purchase')::uuid,null,20000);
select is(seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid),('{"sellerId":"'||current_setting('test.seller')||'","availableOre":0,"reservedOre":0,"creditedOre":0,"paidOre":0,"entries":0}')::jsonb,'empty balance before any sale');
select set_config('test.sale',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid,'manual','L-1','2026-09-13T10:00:00Z','SEK',
 jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',25000),jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',20000)));
select is((select count(*) from seller_ledger_entries where seller_id=current_setting('test.seller')::uuid),1::bigint,'one credit for the consignment line, none for the store line');
select is((select amount_ore from seller_ledger_entries where seller_id=current_setting('test.seller')::uuid),10000::bigint,'credit equals the seller credit on the line');
select is((select reference_id from seller_ledger_entries where seller_id=current_setting('test.seller')::uuid),(select id from sale_lines where sale_id=current_setting('test.sale')::uuid and line_no=1),'credit references the sale line');
select is((select occurred_at from seller_ledger_entries where seller_id=current_setting('test.seller')::uuid),'2026-09-13T10:00:00Z'::timestamptz,'credit dated at the sale');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,10000::bigint,'available balance is the credit');
select is(record_sale(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid,'manual','L-1','2026-09-13T10:00:00Z','SEK',
 jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item1'),'priceOre',25000),jsonb_build_object('itemId',current_setting('test.item2'),'priceOre',20000))),current_setting('test.sale')::uuid,'replay');
select is((select count(*) from seller_ledger_entries),1::bigint,'replay credits nothing twice');
-- Adjustments: owner or admin, reason required, replay-safe, new facts only.
select set_config('test.adj',gen_random_uuid()::text,true);
select throws_like($$select adjust_seller_ledger(current_setting('test.tenant')::uuid,current_setting('test.adj')::uuid,current_setting('test.seller')::uuid,-500,'')$$,'%INVALID_INPUT%','reason required');
select throws_like($$select adjust_seller_ledger(current_setting('test.tenant')::uuid,current_setting('test.adj')::uuid,current_setting('test.seller')::uuid,0,'Nothing')$$,'%INVALID_INPUT%','zero adjustment rejected');
select throws_like($$select adjust_seller_ledger(current_setting('test.tenant')::uuid,current_setting('test.adj')::uuid,gen_random_uuid(),-500,'Unknown')$$,'%SELLER_NOT_FOUND%','unknown seller rejected');
select is(adjust_seller_ledger(current_setting('test.tenant')::uuid,current_setting('test.adj')::uuid,current_setting('test.seller')::uuid,-500,'Damaged label refund'),current_setting('test.adj')::uuid,'owner adjusts with a reason');
select is(adjust_seller_ledger(current_setting('test.tenant')::uuid,current_setting('test.adj')::uuid,current_setting('test.seller')::uuid,-500,'Damaged label refund'),current_setting('test.adj')::uuid,'exact retry');
select throws_like($$select adjust_seller_ledger(current_setting('test.tenant')::uuid,current_setting('test.adj')::uuid,current_setting('test.seller')::uuid,-600,'Damaged label refund')$$,'%REQUEST_CONFLICT%','changed retry rejected');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,9500::bigint,'adjustment changes the sum');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'creditedOre')::bigint,10000::bigint,'credited stays the sales credit');
select throws_ok($$update seller_ledger_entries set amount_ore=1$$,'42501',null,'direct update denied');
select throws_ok($$insert into seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by) values(gen_random_uuid(),current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'credit_sale',1,'sale_line',gen_random_uuid(),now(),'f0000000-0000-4000-8000-000000000141')$$,'42501',null,'direct insert denied');
reset role;
select throws_like($$update seller_ledger_entries set amount_ore=1 where seller_id=current_setting('test.seller')::uuid$$,'%IMMUTABLE_LEDGER%','privileged update immutable');
select throws_like($$delete from seller_ledger_entries where seller_id=current_setting('test.seller')::uuid$$,'%IMMUTABLE_LEDGER%','privileged delete immutable');
select throws_ok($$insert into seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by) values(gen_random_uuid(),current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'credit_sale',-1,'sale_line',gen_random_uuid(),now(),'f0000000-0000-4000-8000-000000000141')$$,'23514',null,'sign convention enforced per kind');
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000142','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000142","role":"authenticated"}';
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'entries')::int,2,'staff reads the balance');
select throws_ok($$select adjust_seller_ledger(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,-1,'Staff cannot')$$,'42501',null,'staff cannot adjust');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000144","role":"authenticated"}';
select throws_ok($$select seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'outsider cannot read a balance');
select is((select count(*) from seller_ledger_entries),0::bigint,'RLS hides other tenants');
select * from finish();
rollback;
