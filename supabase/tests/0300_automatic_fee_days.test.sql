begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('30000000-0000-4000-8000-000000000001','owner@fee-close.test',now()),
 ('30000000-0000-4000-8000-000000000002','worker@fee-close.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Fee-only close TEST','fee-only-close-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@fee-close.test','')::text,true);
select set_config('test.policy',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select set_config('test.grant',gen_random_uuid()::text,true);
select enable_automation(current_setting('test.tenant')::uuid,current_setting('test.grant')::uuid,'day_close','worker@fee-close.test');
reset role;
-- Synthetic recorded historical fees; never alter immutable source facts.
select set_config('test.period',gen_random_uuid()::text,true);
select set_config('test.today',(now() at time zone 'Europe/Stockholm')::date::text,true);
insert into seller_consignment_periods(id,tenant_id,seller_id,started_at,policy_id,fee_terms,currency,authorized_by,created_by)
 values(current_setting('test.period')::uuid,current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,now()-interval '2 months',current_setting('test.policy')::uuid,'{"amountOre":10000,"vatBasis":"inclusive","vatRatePercent":25,"collection":"balance"}','SEK','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
insert into consignment_fees(id,tenant_id,seller_id,period_id,month_index,starts_at,ends_at,net_ore,vat_ore,gross_ore,collection,currency,recorded_by,recorded_at)
 select ('30000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.period')::uuid,i,
 now()+make_interval(months=>i),now()+make_interval(months=>i+1),8000,2000,10000,case when i=1 then 'separate' else 'balance' end,'SEK','30000000-0000-4000-8000-000000000001',
 ((current_setting('test.today')::date-i)::text||' 12:00')::timestamp at time zone 'Europe/Stockholm' from unnest(array[0,1,3,4]) i;
insert into consignment_fee_events(id,tenant_id,fee_id,kind,reason,actor,occurred_at) values
 (gen_random_uuid(),current_setting('test.tenant')::uuid,'30000000-0000-4000-8001-000000000003','reversed','Synthetic reversal','30000000-0000-4000-8000-000000000001',((current_setting('test.today')::date-2)::text||' 12:00')::timestamp at time zone 'Europe/Stockholm');
update automation_grants set enabled_at=((current_setting('test.today')::date-3)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm' where id=current_setting('test.grant')::uuid;
select set_config('test.ledger_count',(select count(*)::text from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid),true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}';
select accept_automation_grants();
select set_config('test.run',gen_random_uuid()::text,true);
select set_config('test.result',run_automatic_day_closes(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid)::text,true);
select is((current_setting('test.result')::jsonb->>'created')::int,2,'fee-only and reversal-only completed days prepared');
select is((current_setting('test.result')::jsonb->>'skipped')::int,1,'separately collected fee does not create a close');
select is((select count(*) from day_closes where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'only eligible complete dates have closes');
select is((select per_mode->'consignment_fee'->>'grossOre' from day_closes where tenant_id=current_setting('test.tenant')::uuid and close_date=current_setting('test.today')::date-3),'10000','fee amount preserved');
select is((select per_mode->'consignment_fee_reversal'->>'grossOre' from day_closes where tenant_id=current_setting('test.tenant')::uuid and close_date=current_setting('test.today')::date-2),'10000','reversal amount preserved separately');
select is((select count(*) from day_closes where tenant_id=current_setting('test.tenant')::uuid and close_date in (current_setting('test.today')::date,current_setting('test.today')::date-4)),0::bigint,'current day and pre-activation date excluded');
select is(run_automatic_day_closes(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid),current_setting('test.result')::jsonb,'same request replays recorded result');
select is((run_automatic_day_closes(current_setting('test.tenant')::uuid,gen_random_uuid())->>'created')::int,0,'repeat preparation does not duplicate versions');
select is((select count(*)::text from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid),current_setting('test.ledger_count'),'preparation does not charge or reverse fees');
select is((select count(*) from accounting_exports where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'preparation creates no exports');
set local "request.jwt.claims"='{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.close',(select id::text from day_closes where tenant_id=current_setting('test.tenant')::uuid and close_date=current_setting('test.today')::date-3),true);
select is((preview_voucher(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid)->>'balanced')::boolean,false,'missing fee mapping still blocks export');
select is((select x->>'status' from jsonb_array_elements(accounting_reconciliation(current_setting('test.tenant')::uuid,current_setting('test.today')::date-3,current_setting('test.today')::date-3)->'days') x),'not_exported','existing reconciliation sees the prepared fee-only day');
select * from finish();
rollback;
