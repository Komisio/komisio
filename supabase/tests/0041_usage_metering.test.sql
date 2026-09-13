begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000241','usage-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000242','usage-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000241","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Usage test','usage-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Usage other','usage-other',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@usage.test','')::text,true);
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"assistanceMonthlyQuota":2.5}')$$,'%INVALID_INPUT%','quota must be an integer');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"assistanceMonthlyQuota":"10"}')$$,'%INVALID_INPUT%','quota must be a number');
select is((select count(*) from usage_summary(current_setting('test.tenant')::uuid)),3::bigint,'summary lists every metered feature');
select is((select units from usage_summary(current_setting('test.tenant')::uuid) where feature='print_job'),0::bigint,'nothing used yet');
select is((select quota from usage_summary(current_setting('test.tenant')::uuid) where feature='reception_assistance'),null,'no quota by default');
select throws_like($$select * from usage_summary(current_setting('test.tenant')::uuid,'2026-13')$$,'%INVALID_INPUT%','period validated');
-- Quota 0: assistance is blocked before any attempt is stored.
select set_config('test.p1',gen_random_uuid()::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,null,current_setting('test.body')::jsonb || '{"assistanceEnabled":true,"assistanceMonthlyQuota":0}');
select set_config('test.session',gen_random_uuid()::text,true);
select create_reception_session(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 '[{"id":"f0000000-0000-4000-8000-000000000250","kind":"observation","reference":"test","observation":"Jacket"}]');
select throws_ok($$select reserve_reception_assistance(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-v1')$$,'P0001','USAGE_QUOTA_EXCEEDED','zero quota blocks assistance');
select is((select count(*) from reception_assistance_attempts where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'blocked attempt is not stored');
-- Quota 1: the first attempt is metered.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,current_setting('test.body')::jsonb || '{"assistanceEnabled":true,"assistanceMonthlyQuota":1}');
select is(reserve_reception_assistance(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'test-model','reception-v1'),true,'attempt within quota reserved');
select is((select units||'|'||quota from usage_summary(current_setting('test.tenant')::uuid) where feature='reception_assistance'),'1|1','assistance metered against its quota');
-- Other features are counted through their own tables.
select set_config('test.printer',gen_random_uuid()::text,true);
select register_printer(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'Counter','tcp','192.168.1.50:9100','ZD421',203);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',null)::text,true);
select queue_print_job(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.printer')::uuid,'bag','zpl-v1','bag_receipt',current_setting('test.bag')::uuid,'^XA^XZ');
select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null);
select is((select string_agg(feature||'='||units,',' order by feature) from usage_summary(current_setting('test.tenant')::uuid)),'print_job=1,reception_assistance=1,seller_email=1','every feature counted once');
select is((select units from usage_summary(current_setting('test.tenant')::uuid,'2020-01') where feature='print_job'),0::bigint,'another period is empty');
select is((select units from usage_summary(current_setting('test.other')::uuid) where feature='print_job'),0::bigint,'usage stays per tenant');
select is((select period from usage_events where tenant_id=current_setting('test.tenant')::uuid limit 1),to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM'),'period is the store month');
reset role;
select throws_ok($$delete from usage_events where tenant_id=current_setting('test.tenant')::uuid$$,'55000',null,'usage events are immutable even for the owner role');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000241","role":"authenticated"}';
select throws_ok($$insert into usage_events(tenant_id,feature,units,period,reference_id) values(current_setting('test.tenant')::uuid,'print_job',5,'2026-09',gen_random_uuid())$$,'42501',null,'no direct inserts');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000242","role":"authenticated"}';
select throws_ok($$select * from usage_summary(current_setting('test.tenant')::uuid)$$,'42501',null,'non-member cannot read usage');
select * from finish();
rollback;
