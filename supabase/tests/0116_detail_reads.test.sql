begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000961','detail-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000962','detail-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000961","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Detail test','detail-reads-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@detail.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin","vatRatePercent":25}');
create temp view lines as select jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',25000)) as l;
select set_config('test.sale',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid,'manual','T-1','2026-09-13T10:00:00Z','SEK',(select l from lines));
select set_config('test.close',gen_random_uuid()::text,true);
select generate_day_close(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid,'2026-09-13');

-- One item: the row the web renders, its price history and its events.
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->>'id',current_setting('test.item'),'the item is returned under item');
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->>'ownership','consignment','with the fields the application parses');
select ok(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->'terms' is not null,'and the frozen terms');
select is(jsonb_typeof(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'prices'),'array','prices are an array');
select is((item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'prices'->0->>'price_ore')::bigint,25000::bigint,'the accepted price is the first price');
select ok(jsonb_array_length(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'events')>0,'events are recorded');
select is(item_detail(current_setting('test.tenant')::uuid,gen_random_uuid()),null,'an unknown item is null, not an error');

-- Receipts: the list the agent filters and one sale with its frozen lines.
select is(jsonb_array_length(sales_page(current_setting('test.tenant')::uuid,null,null,null,50)),1,'one sale is listed');
select is(sales_page(current_setting('test.tenant')::uuid,'manual',null,null,50)->0->>'external_id','T-1','the provider filter matches');
select is(jsonb_array_length(sales_page(current_setting('test.tenant')::uuid,'zettle',null,null,50)),0,'another provider matches nothing');
select is(jsonb_array_length(sales_page(current_setting('test.tenant')::uuid,null,'T-1',null,50)),1,'the external id filter matches');
select is(jsonb_array_length(sales_page(current_setting('test.tenant')::uuid,null,null,'completed',50)),1,'the status filter matches');
select throws_like($$select sales_page(current_setting('test.tenant')::uuid,null,null,null,0)$$,'%INVALID_INPUT%','a limit outside the range is refused');
select is(sale_detail(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid)->'sale'->>'id',current_setting('test.sale'),'the sale is returned under sale');
select is((sale_detail(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid)->'sale'->>'total_ore')::bigint,25000::bigint,'with its total');
select is(jsonb_array_length(sale_detail(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid)->'lines'),1,'and its frozen lines');
select is(sale_detail(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid)->'lines'->0->>'vat_mode','consignment_margin','the line keeps the VAT mode it froze');
select is(sale_detail(current_setting('test.tenant')::uuid,gen_random_uuid()),null,'an unknown sale is null');

-- The seller ledger and the day closes.
select ok(jsonb_array_length(seller_ledger_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid))>0,'the sale credited the seller');
select is(seller_ledger_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->0->>'reference_kind','sale_line','the entry cites the sale line');
select is(jsonb_array_length(day_close_page(current_setting('test.tenant')::uuid)),1,'the day close is listed');
select is(day_close_page(current_setting('test.tenant')::uuid)->0->>'close_date','2026-09-13','with its date');
select is((day_close_page(current_setting('test.tenant')::uuid)->0->>'sales_count')::int,1,'and the day''s sale count');

-- Every read belongs to a member of that store.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000962","role":"authenticated"}';
select throws_ok($$select item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)$$,'42501',null,'an outsider cannot read an item');
select throws_ok($$select sales_page(current_setting('test.tenant')::uuid,null,null,null,50)$$,'42501',null,'an outsider cannot list receipts');
select throws_ok($$select sale_detail(current_setting('test.tenant')::uuid,current_setting('test.sale')::uuid)$$,'42501',null,'an outsider cannot read a receipt');
select throws_ok($$select seller_ledger_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'an outsider cannot read a ledger');
select throws_ok($$select day_close_page(current_setting('test.tenant')::uuid)$$,'42501',null,'an outsider cannot read day closes');
-- The connector reaches each one under the scope that covers it.
reset role;
-- Counted by name, not by row: a function may be listed under more than one
-- scope when a tool that needs it asks for a different one.
select is((select count(distinct function_name) from connector_functions where function_name in ('item_detail','sales_page','sale_detail','seller_ledger_page','day_close_page')),5::bigint,'each read is listed for the connector');
select is((select scope from connector_functions where function_name='sale_detail'),'sales:read','a receipt needs the sales read scope');
select * from finish();
rollback;
