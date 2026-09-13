begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('bulkItemUpdate'),'medium','bulk item updates are medium risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000251','bulk-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000252','bulk-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000251","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Bulk test','bulk-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@bulk.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Synthetic scarf','Accessories','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,10000);
-- Manual price set by a person.
select throws_like($$select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i1')::uuid,0,'Wrong')$$,'%INVALID_INPUT%','price must be positive');
select throws_like($$select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i1')::uuid,15000,'')$$,'%INVALID_INPUT%','reason required');
select set_config('test.e1',gen_random_uuid()::text,true);
select is(set_item_price(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.i1')::uuid,15000,'Seller agreed to a lower price'),current_setting('test.e1')::uuid,'price set');
select is(set_item_price(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.i1')::uuid,15000,'Seller agreed to a lower price'),current_setting('test.e1')::uuid,'replay');
select throws_like($$select set_item_price(current_setting('test.tenant')::uuid,current_setting('test.e1')::uuid,current_setting('test.i1')::uuid,14000,'Seller agreed to a lower price')$$,'%REQUEST_CONFLICT%','changed replay refused');
select is((select price_ore||'|'||reason from item_prices where item_id=current_setting('test.i1')::uuid order by seq desc limit 1),'15000|manual','manual price row');
select is((select detail->>'previousPriceOre' from item_events where id=current_setting('test.e1')::uuid),'20000','event keeps the previous price');
select is((select current_price_ore from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.i1')::uuid),15000::bigint,'lifecycle sees the new price');
-- Sell item 1 so the bulk preflight has a sold item to refuse.
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',15000)));
select throws_like($$select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i1')::uuid,9000,'Too late')$$,'%ITEM_NOT_ON_SALE%','a sold item cannot be repriced');
-- Bulk proposals.
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'bulkItemUpdate',jsonb_build_object('action','setPrice','reason','Sale','items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2')))),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','setPrice items need a price');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'bulkItemUpdate',jsonb_build_object('action','endPeriod','endAction','burn','note','','items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2')))),'agent',now()+interval '1 day')$$,'%INVALID_INPUT%','end action validated');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'bulkItemUpdate',jsonb_build_object('action','setPrice','reason','Sale','items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',9000),jsonb_build_object('itemId',current_setting('test.i2'),'priceOre',8000))),'agent',now()+interval '1 day')$$,'%ITEM_NOT_ON_SALE%','one sold item refuses the whole set');
select set_config('test.op1',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op1')::uuid,'bulkItemUpdate',jsonb_build_object('action','setPrice','reason','Weekend sale','items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'priceOre',8000))),'pricing-agent',now()+interval '1 day'),current_setting('test.op1')::uuid,'bulk price change proposed');
select throws_ok($$select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op1')::uuid,'approved','')$$,'42501',null,'proposer cannot approve a bulk update');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000252','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000252","role":"authenticated"}';
select set_config('test.dec1',gen_random_uuid()::text,true);
select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.dec1')::uuid,current_setting('test.op1')::uuid,'approved','Checked the list');
select is((select outcome||'|'||result_id from operation_decisions where id=current_setting('test.dec1')::uuid),'executed|'||current_setting('test.op1'),'bulk price change executed');
select is((select price_ore||'|'||reason from item_prices where item_id=current_setting('test.i2')::uuid order by seq desc limit 1),'8000|manual','price applied through the bulk update');
select is((select detail->>'reason' from item_events where item_id=current_setting('test.i2')::uuid and kind='price_set' and detail ? 'previousPriceOre'),'Weekend sale','event carries the shared reason');
-- Staff proposes an end of period; the owner approves; the item leaves sale.
select set_config('test.op2',gen_random_uuid()::text,true);
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op2')::uuid,'bulkItemUpdate',jsonb_build_object('action','endPeriod','endAction','return','note','Season over','items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2')))),'season-agent',now()+interval '1 day'),current_setting('test.op2')::uuid,'bulk end proposed');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000251","role":"authenticated"}';
select decide_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.op2')::uuid,'approved','');
select is((select outcome from operation_decisions where operation_id=current_setting('test.op2')::uuid),'executed','bulk end executed');
select is((select stage from lifecycle_queue(current_setting('test.tenant')::uuid) where item_id=current_setting('test.i2')::uuid),'ended','item ended through the bulk update');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'bulkItemUpdate',jsonb_build_object('action','setPrice','reason','Late','items',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'priceOre',5000))),'agent',now()+interval '1 day')$$,'%ITEM_ENDED%','an ended item cannot be proposed');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'executed',null,null,'bulkItemUpdate')),2::bigint,'queue filters the bulk kind');
select * from finish();
rollback;
