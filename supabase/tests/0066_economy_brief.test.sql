begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000421','brief-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000422','brief-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000421","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Brief test','brief-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@brief.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,50000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,30000);
-- One sale in ISO week 36 (Wednesday 2026-09-02) and one in week 37 (Tuesday 2026-09-08, 22:30 UTC = Wednesday 00:30 local).
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-02T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',50000)));
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-2','2026-09-08T22:30:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'priceOre',30000)));
-- Period bounds: the week is Monday to Sunday around the anchor; the month is the calendar month.
select set_config('test.w',economy_brief(current_setting('test.tenant')::uuid,'week','2026-09-12')::text,true);
select is(current_setting('test.w')::jsonb->'period'->>'from','2026-09-07','week starts on Monday');
select is(current_setting('test.w')::jsonb->'period'->>'to','2026-09-13','week ends on Sunday');
select is(current_setting('test.w')::jsonb->'previousPeriod'->>'from','2026-08-31','previous week');
select is(current_setting('test.w')::jsonb->'previousPeriod'->>'to','2026-09-06','previous week end');
select is((current_setting('test.w')::jsonb->'current'->>'grossOre')::bigint,30000::bigint,'this week: the local-Wednesday sale');
select is((current_setting('test.w')::jsonb->'previous'->>'grossOre')::bigint,50000::bigint,'last week: the other sale');
select is(current_setting('test.w')::jsonb->'bestDay'->>'date','2026-09-09','best day named in local time');
select is(current_setting('test.w')::jsonb->>'currency','SEK','currency carried');
select set_config('test.m',economy_brief(current_setting('test.tenant')::uuid,'month','2026-09-30')::text,true);
select is(current_setting('test.m')::jsonb->'period'->>'from','2026-09-01','month starts on the first');
select is(current_setting('test.m')::jsonb->'period'->>'to','2026-09-30','month ends on the last day');
select is(current_setting('test.m')::jsonb->'previousPeriod'->>'from','2026-08-01','previous month');
select is((current_setting('test.m')::jsonb->'current'->>'salesCount')::int,2,'both sales in September');
select is((current_setting('test.m')::jsonb->'previous'->>'salesCount')::int,0,'none in August');
select is((current_setting('test.m')::jsonb->>'itemsAccepted')::int,2,'items accepted this month counted');
select is(jsonb_typeof(economy_brief(current_setting('test.tenant')::uuid,'week',null)),'object','null anchor means yesterday');
-- February in a leap year and the year boundary.
select is(economy_brief(current_setting('test.tenant')::uuid,'month','2028-02-15')->'period'->>'to','2028-02-29','leap February');
select is(economy_brief(current_setting('test.tenant')::uuid,'month','2027-01-10')->'previousPeriod'->>'from','2026-12-01','previous month across the year');
select is(economy_brief(current_setting('test.tenant')::uuid,'week','2027-01-01')->'period'->>'from','2026-12-28','week across the year');
select throws_like($$select economy_brief(current_setting('test.tenant')::uuid,'quarter','2026-09-12')$$,'%INVALID_INPUT%','only week and month');
select throws_like($$select economy_brief(current_setting('test.tenant')::uuid,'week','1999-12-31')$$,'%INVALID_INPUT%','anchor far in the past refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000422","role":"authenticated"}';
select throws_ok($$select economy_brief(current_setting('test.tenant')::uuid,'week','2026-09-12')$$,'42501',null,'outsider refused');
select * from finish();
rollback;
