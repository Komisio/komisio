begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4260000-0000-4000-8000-000000000001','collection-owner@example.test',now()),
 ('f4260000-0000-4000-8000-000000000002','collection-seller@example.test',now()),
 ('f4260000-0000-4000-8000-000000000003','collection-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4260000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Collection test','collection-grace-test',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','collection-seller@example.test','') as seller \gset
select publish_seller_agreement(:'tenant',gen_random_uuid(),null,'Synthetic terms','Only a test','en',false) as agreement \gset
select record_agreement_evidence(:'tenant',gen_random_uuid(),:'seller',:'agreement','Synthetic paper');
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"endOfPeriodAction":"return","markdownSteps":[],"vatModeConsignmentPrivate":"consignment_margin"}');
select set_config('test.tenant',:'tenant',true),set_config('test.seller',:'seller',true),set_config('test.agreement',:'agreement',true);
create function pg_temp.item() returns uuid language plpgsql as $$
declare bag uuid; draft uuid:=gen_random_uuid(); item uuid:=gen_random_uuid();
begin
 bag:=public.receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid);
 perform pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),bag,draft,0,'Synthetic coat','Coats','Good');
 perform public.accept_item(current_setting('test.tenant')::uuid,item,'reception_review',draft,1,20000);
 return item;
end $$;
create function pg_temp.policy(p_patch jsonb) returns uuid language sql as $$
 select public.publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(public.current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,
 (public.current_store_policy(current_setting('test.tenant')::uuid)->'policy')||p_patch);
$$;
select pg_temp.item() as legacy \gset
select pg_temp.policy('{"collectionDays":7}');
select pg_temp.item() as item \gset
select is((select terms->>'collectionDays' from items where id=:'item'),'7','new day-based return item freezes grace days');
select ok(not(select terms ? 'collectionDays' from items where id=:'legacy'),'old item remains unchanged');
select is((select count(*) from consignment_receipt_periods where tenant_id=:'tenant'),0::bigint,'day mode does not create calendar receipt/fee records');
select throws_like($$select pg_temp.policy('{"collectionDays":-1}')$$,'%INVALID_INPUT%','negative grace rejected');
select throws_like($$select pg_temp.policy('{"collectionDays":366}')$$,'%INVALID_INPUT%','overlong grace rejected');
select throws_like($$select pg_temp.policy('{"collectionDays":1.5}')$$,'%INVALID_INPUT%','fractional grace rejected');
select throws_like($$select pg_temp.policy('{"collectionDays":"7"}')$$,'%INVALID_INPUT%','string grace rejected');
select throws_like($$select pg_temp.policy('{"collectionDays":null}')$$,'%INVALID_INPUT%','null grace rejected');
select throws_like($$select pg_temp.policy('{"consignmentPeriod":{"months":3,"collectionDays":2}}')$$,'%INVALID_INPUT%','two competing grace settings rejected');
select is((lifecycle_queue_page(:'tenant',:'item')->'rows'->0->>'collection_deadline')::timestamptz,
 (((lifecycle_queue_page(:'tenant',:'item')->'rows'->0->>'period_end')::timestamptz at time zone 'Europe/Stockholm')+interval '7 days') at time zone 'Europe/Stockholm','queue uses local calendar days');
select pg_temp.policy('{"collectionDays":21}');
select is((select terms->>'collectionDays' from items where id=:'item'),'7','later store policy cannot rewrite frozen grace');
select extend_sale_period(:'tenant',gen_random_uuid(),:'item',3,'Synthetic extension');
select is((lifecycle_queue_page(:'tenant',:'item')->'rows'->0->>'collection_deadline')::timestamptz,
 (((lifecycle_queue_page(:'tenant',:'item')->'rows'->0->>'period_end')::timestamptz at time zone 'Europe/Stockholm')+interval '7 days') at time zone 'Europe/Stockholm','extension keeps grace relative to extended end');
select gen_random_uuid() as end_id \gset
select end_sale_period(:'tenant',:'end_id',:'item','return','Synthetic return');
select reopen_item_period(:'tenant',gen_random_uuid(),:'item',:'end_id',(now() at time zone 'Europe/Stockholm')::date+20,'Synthetic reopen');
select is((lifecycle_queue_page(:'tenant',:'item')->'rows'->0->>'collection_deadline')::timestamptz,
 (((lifecycle_queue_page(:'tenant',:'item')->'rows'->0->>'period_end')::timestamptz at time zone 'Europe/Stockholm')+interval '7 days') at time zone 'Europe/Stockholm','reopening keeps original grace');
select is((select count(*) from consignment_fees where tenant_id=:'tenant'),0::bigint,'no fee on reopening');
select throws_like(format('select end_sale_period(%L,gen_random_uuid(),%L,''recycle'',''Too early'')',:'tenant',:'item'),'%COLLECTION_NOT_DUE%','recycling still waits for grace');
select pg_temp.policy('{"collectionDays":0}');
select pg_temp.item() as zero_item \gset
select is(lifecycle_queue_page(:'tenant',:'zero_item')->'rows'->0->>'collection_deadline',lifecycle_queue_page(:'tenant',:'zero_item')->'rows'->0->>'period_end','zero grace ends at sale-period boundary');
select pg_temp.policy('{"collectionDays":7,"endOfPeriodAction":"charity"}');
select pg_temp.item() as charity \gset
select ok(not(select terms ? 'collectionDays' from items where id=:'charity'),'charity disposition is not silently changed into collection');
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,((current_store_policy(:'tenant')->'policy')-'collectionDays')||'{"consignmentPeriod":{"months":3,"collectionDays":2}}');
select pg_temp.item() as calendar \gset
select ok((select terms ? 'consignmentPeriod' from items where id=:'calendar'),'calendar receipt snapshot retained');
select ok(not(select terms ? 'collectionDays' from items where id=:'calendar'),'calendar item has only its original snapshot');
select is((select ownership from items where id=:'item'),'consignment','no ownership transfer');
select is((select seller_id from items where id=:'item'),:'seller'::uuid,'original seller retained');
select is((select current_price_ore from lifecycle_queue(:'tenant') where item_id=:'item'),20000::bigint,'price retained');
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,((current_store_policy(:'tenant')->'policy')-'consignmentPeriod')||'{"collectionDays":7,"endOfPeriodAction":"return"}');
set local "request.jwt.claims"='{"sub":"f4260000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_seller_terms_summary(:'tenant',:'seller')->>'collectionDays','7','seller summary exposes current day-mode grace');
select ok(exists(select 1 from jsonb_array_elements(my_items_page(:'tenant',:'seller','',0,'all')->'items') i where i->>'id'=:'item' and i->>'collectionDeadline' is not null),'seller item projection exposes frozen deadline');
set local "request.jwt.claims"='{"sub":"f4260000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(format('select lifecycle_queue_page(%L)',:'tenant'),'42501',null,'outsider cannot read collection deadlines');
reset role;
select ok(not has_function_privilege('authenticated','komisio_private.freeze_item_collection_days()','execute'),'clients cannot invoke snapshot trigger');
select * from finish();
rollback;
