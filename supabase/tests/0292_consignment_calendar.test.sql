begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.consignment_month_end('2024-01-31 11:00+01',1), '2024-02-29 11:00+01'::timestamptz,'leap month clamps to its last day');
select is(komisio_private.consignment_month_end('2025-01-31 11:00+01',2), '2025-03-31 11:00+02'::timestamptz,'months use the original anchor and Stockholm wall time');
select is(komisio_private.consignment_month_end('2026-10-10 12:00+02',3), '2027-01-10 12:00+01'::timestamptz,'three months is not ninety days');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001751','calendar-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000001752','calendar-other@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001751","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Calendar test','calendar-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','calendar-seller@example.test','')::text,true);
select set_config('test.legacy',receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Legacy')::text,true);
select set_config('test.policy',gen_random_uuid()::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.policy')::uuid,null,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"consignmentPeriod":{"months":3,"collectionDays":2},"markdownSteps":[],"endOfPeriodAction":"return"}');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"consignmentPeriod":{"months":0,"collectionDays":2}}')$$,'%INVALID_INPUT%','zero months rejected');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"consignmentPeriod":{"months":3,"collectionDays":2,"fee":100}}')$$,'%INVALID_INPUT%','unknown financial fields rejected');
select set_config('test.bag',receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Calendar receipt')::text,true);
select is((select count(*) from consignment_receipt_periods where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'only opted-in receipts have frozen periods');
select is((select sale_ends_at from consignment_receipt_periods where bag_id=current_setting('test.bag')::uuid),
 ((now() at time zone 'Europe/Stockholm')+interval '3 months') at time zone 'Europe/Stockholm','period starts at receipt');
select is((select collection_ends_at from consignment_receipt_periods where bag_id=current_setting('test.bag')::uuid),
 ((now() at time zone 'Europe/Stockholm')+interval '3 months 2 days') at time zone 'Europe/Stockholm','collection adds local calendar days');
select receive_bag(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,current_setting('test.seller')::uuid,'Calendar receipt');
select is((select count(*) from consignment_receipt_periods),1::bigint,'receiving retry does not duplicate a period');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy')::uuid,
 (current_store_policy(current_setting('test.tenant')::uuid)->'policy')-'consignmentPeriod');
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic coat','Coats','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,15000);
select is((select terms->'consignmentPeriod'->>'receiptId' from items where id=current_setting('test.item')::uuid),current_setting('test.bag'),'acceptance inherits frozen receipt after policy is disabled');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid)->'rows'->0->>'collection_deadline')::timestamptz,
 (select collection_ends_at from consignment_receipt_periods where bag_id=current_setting('test.bag')::uuid),'staff queue exposes collection deadline');
select throws_like($$select end_sale_period(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,'recycle','Physical recycling')$$,'%COLLECTION_NOT_DUE%','cannot recycle before collection deadline');
select throws_ok($$insert into consignment_receipt_periods(tenant_id,seller_id,bag_id,policy_id,received_at,sale_ends_at,collection_ends_at,recorded_by) values(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.legacy')::uuid,current_setting('test.policy')::uuid,now(),now(),now(),auth.uid())$$,'42501',null,'direct writes denied');
reset role;
select throws_like($$update consignment_receipt_periods set sale_ends_at=now()$$,'%IMMUTABLE_CONSIGNMENT_PERIOD%','even privileged edits cannot rewrite terms');
select throws_like($$delete from consignment_receipt_periods$$,'%IMMUTABLE_CONSIGNMENT_PERIOD%','period history cannot be deleted');
-- A historical receipt fixture exercises delayed acceptance and completed collection.
insert into bag_receipts(id,tenant_id,seller_id,note,created_by,received_at)
 values('f0000000-0000-4000-8000-000000001759',current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'Historical fixture','f0000000-0000-4000-8000-000000001751',now()-interval '6 months');
insert into consignment_receipt_periods(tenant_id,seller_id,bag_id,policy_id,received_at,sale_ends_at,collection_ends_at,recorded_by)
 values(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'f0000000-0000-4000-8000-000000001759',current_setting('test.policy')::uuid,now()-interval '6 months',now()-interval '3 months',now()-interval '3 months'+interval '2 days','f0000000-0000-4000-8000-000000001751');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001751","role":"authenticated"}';
select set_config('test.oldDraft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000001759',current_setting('test.oldDraft')::uuid,0,'Old coat','Coats','Good');
select set_config('test.oldItem',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.oldItem')::uuid,'inspection_draft',current_setting('test.oldDraft')::uuid,1,15000);
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,current_setting('test.oldItem'))->'rows'->0->>'stage'),'period_ended','late registration does not restart the sale period');
select set_config('test.recycling',gen_random_uuid()::text,true);
select is(end_sale_period(current_setting('test.tenant')::uuid,current_setting('test.recycling')::uuid,current_setting('test.oldItem')::uuid,'recycle','Physically recycled'),current_setting('test.recycling')::uuid,'staff records recycling');
select is(end_sale_period(current_setting('test.tenant')::uuid,current_setting('test.recycling')::uuid,current_setting('test.oldItem')::uuid,'recycle','Physically recycled'),current_setting('test.recycling')::uuid,'recycling retry is safe');
select throws_like($$select end_sale_period(current_setting('test.tenant')::uuid,current_setting('test.recycling')::uuid,current_setting('test.oldItem')::uuid,'return','Physically recycled')$$,'%REQUEST_CONFLICT%','replay cannot change disposition');
select is((select detail->>'action' from item_events where id=current_setting('test.recycling')::uuid),'recycle','recycling is distinct from charity');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001752","role":"authenticated"}';
select is((select count(*) from consignment_receipt_periods),0::bigint,'other tenants cannot read periods');
select throws_ok($$select lifecycle_queue_page(current_setting('test.tenant')::uuid)$$,'42501',null,'other tenant cannot read deadlines through RPC');
select * from finish();
rollback;
