begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000131','sale-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000132','sale-reader@example.test',now()),
 ('f0000000-0000-4000-8000-000000000134','sale-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000131","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Sale notes test','sale-notes-test',gen_random_uuid())::text,true);
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
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin"}');
create function pg_temp.note_sale(note jsonb) returns uuid language sql as $$
 select record_sale(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005700','manual','NOTE-1','2026-10-20T10:00:00Z','SEK',(select l from lines),jsonb_build_object('manualNote',note))
$$;
select throws_like($$select pg_temp.note_sale(to_jsonb(repeat('x',501)))$$,'%INVALID_INPUT%','note length bounded');
select throws_like($$select pg_temp.note_sale('123')$$,'%INVALID_INPUT%','non-text note refused');
select lives_ok($$select pg_temp.note_sale('"Instagram MP-123"')$$,'manual note stored');
select lives_ok($$select pg_temp.note_sale('"Instagram MP-123"')$$,'exact note retry accepted');
select throws_like($$select pg_temp.note_sale('"Changed"')$$,'%SALE_CONFLICT%','changed note cannot replay sale');
select is((select staff_note from sales where external_id='NOTE-1'),'Instagram MP-123','note preserved');
select is(sale_detail(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005700')->'sale'->>'staff_note','Instagram MP-123','staff receipt exposes note');
select is(sales_page(current_setting('test.tenant')::uuid,null,null,null,50)->0->>'staff_note','Instagram MP-123','staff list exposes note');
select is((select count(*) from sales where external_id='NOTE-1'),1::bigint,'retry makes one sale');
select is((select sum(seller_credit_ore) from sale_lines where sale_id='f0000000-0000-4000-8000-000000005700'),10000::numeric,'note leaves seller credit unchanged');
reset role;
select throws_like($$update sales set staff_note='overwrite' where external_id='NOTE-1'$$,'%IMMUTABLE_SALE%','note immutable even with privileged access');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000134","role":"authenticated"}';
select throws_ok($$select sale_detail(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005700')$$,'42501',null,'non-member cannot read note');
select is((select count(*) from sales),0::bigint,'RLS hides note');
select * from finish();
rollback;
