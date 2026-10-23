begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000005641','economic-payment-delta@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005641","role":"authenticated"}';
select set_config('test.tenant',create_tenant_with_locale('Economic payment delta','economic-payment-delta',gen_random_uuid(),'dk')::text,true);
select store_economic_connection(current_setting('test.tenant')::uuid,123456,'Synthetic','','DKK','{"iv":"a","tag":"b","data":"c"}');
select set_config('test.map',gen_random_uuid()::text,true);
select publish_economic_map(current_setting('test.tenant')::uuid,current_setting('test.map')::uuid,null,123456,1,
 '{"grossOre":{"account":"10000","side":"debit","vatCode":"Z0"},"payment:mobilepay:grossOre":{"account":"10000","side":"debit","vatCode":"Z0"},"commissionOre":{"account":"30000","side":"credit","vatCode":"Z0"}}');
-- Frozen totals isolate delivery arithmetic; no provider or hosted data is used.
reset role;
insert into day_closes(id,tenant_id,close_date,version,gross_ore,commission_ore,generated_by,payment_totals)
 select id::uuid,tenant_id,close_date::date,version,gross_ore,commission_ore,generated_by::uuid,
 jsonb_build_object('mobilepay',jsonb_build_object('grossOre',gross_ore,'refundsOre',0,'commissionOre',commission_ore,'commissionVatOre',0,'sellerCreditOre',0,'creditReversedOre',0,'vatOre',0,'perMode','{}'::jsonb))
 from (values
('f0000000-0000-4000-8000-000000005642',current_setting('test.tenant')::uuid,'2026-10-01',1,25000,25000,'f0000000-0000-4000-8000-000000005641'),
 ('f0000000-0000-4000-8000-000000005643',current_setting('test.tenant')::uuid,'2026-10-01',2,40000,40000,'f0000000-0000-4000-8000-000000005641'),
 ('f0000000-0000-4000-8000-000000005644',current_setting('test.tenant')::uuid,'2026-10-01',3,35000,35000,'f0000000-0000-4000-8000-000000005641'),
 ('f0000000-0000-4000-8000-000000005645',current_setting('test.tenant')::uuid,'2026-10-01',4,35000,35000,'f0000000-0000-4000-8000-000000005641')
) v(id,tenant_id,close_date,version,gross_ore,commission_ore,generated_by);
set local role authenticated;
select set_config('test.export1',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005642')::text,true);
select set_config('test.stale',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005643')::text,true);
select set_config('test.send1',gen_random_uuid()::text,true);
select begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send1')::uuid,current_setting('test.export1')::uuid);
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.stale')::uuid)$$,'%ECONOMIC_DAY_UNRESOLVED%','pending earlier version blocks another export');
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send1')::uuid,'failed',null,'ECONOMIC_OUTCOME_UNKNOWN','ECONOMIC_UNVERIFIED_ENTRIES',null);
select throws_like($$select export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005644')$$,'%ECONOMIC_DAY_UNRESOLVED%','unknown earlier version blocks preparation');
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005643')->>'blockedReason','ECONOMIC_DAY_UNRESOLVED','preview explains unresolved day');
select confirm_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send1')::uuid,1,42,'Synthetic lines verified');
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005643')->>'debitOre','15000','250 + 150 sends only 150 next');
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.stale')::uuid)$$,'%ECONOMIC_BASELINE_CHANGED%','prepared full snapshot cannot be sent after baseline advances');
select set_config('test.export2',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005643')::text,true);
select isnt(current_setting('test.export2'),current_setting('test.stale'),'new baseline creates a new immutable export');
select is((select debit_ore from economic_exports where id=current_setting('test.stale')::uuid),40000::bigint,'old prepared export unchanged');
select is((select baseline_export_id from economic_exports where id=current_setting('test.export2')::uuid),current_setting('test.export1')::uuid,'baseline provenance frozen');
select set_config('test.send2',gen_random_uuid()::text,true);
select begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send2')::uuid,current_setting('test.export2')::uuid);
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send2')::uuid,'sent',43,'','',null);
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005644')->>'debitOre','5000','lower target produces a 50 reversal, not another full snapshot');
select is((select l->>'side' from jsonb_array_elements(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005644')->'lines') l where l->>'key'='payment:mobilepay:grossOre'),'credit','negative difference reverses debit to credit');
select set_config('test.export3',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005644')::text,true);
select set_config('test.send3',gen_random_uuid()::text,true);
select begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send3')::uuid,current_setting('test.export3')::uuid);
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send3')::uuid,'sent',44,'','',null);
select throws_like($$select export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005645')$$,'%ECONOMIC_NO_CHANGES%','unchanged totals never create another voucher');
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.stale')::uuid)$$,'%ECONOMIC_BASELINE_CHANGED%','older prepared exports remain blocked');
select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.map')::uuid,123456,2,current_economic_map(current_setting('test.tenant')::uuid)->'map');
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005645')->>'blockedReason','ECONOMIC_DAY_CONTEXT_CHANGED','journal changes do not silently repost');
select throws_ok($$select preview_economic_voucher(gen_random_uuid(),'f0000000-0000-4000-8000-000000005645')$$,'42501',null,'delta preview remains tenant scoped');
select throws_ok($$update economic_exports set debit_ore=1 where id=current_setting('test.export3')::uuid$$,'42501',null,'no direct export writes');
reset role;
-- Historical snapshots remain immutable. One verified legacy export is usable;
-- two full snapshots are ambiguous and must never silently produce a reversal.
insert into day_closes(id,tenant_id,close_date,version,gross_ore,commission_ore,generated_by)
 select ('f0000000-0000-4000-8000-00000000565'||n)::uuid,current_setting('test.tenant')::uuid,'2026-10-02',n,n*10000,n*10000,'f0000000-0000-4000-8000-000000005641' from generate_series(1,3) n;
insert into economic_exports(id,tenant_id,day_close_id,map_id,agreement_number,journal_number,voucher,excluded,debit_ore,credit_ore,created_by)
 select ('f0000000-0000-4000-8000-00000000566'||n)::uuid,current_setting('test.tenant')::uuid,('f0000000-0000-4000-8000-00000000565'||n)::uuid,current_setting('test.map')::uuid,123456,1,
 jsonb_build_array(jsonb_build_object('key','grossOre','account','10000','side','debit','vatCode','Z0','amountOre',n*10000),jsonb_build_object('key','commissionOre','account','30000','side','credit','vatCode','Z0','amountOre',n*10000)),
 '{}',n*10000,n*10000,'f0000000-0000-4000-8000-000000005641' from generate_series(1,2) n;
insert into economic_sends(id,tenant_id,export_id,agreement_number,journal_number,status,voucher_number,actor,completed_at)
 values(gen_random_uuid(),current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005661',123456,1,'sent',51,'f0000000-0000-4000-8000-000000005641',now());
set local role authenticated;
-- Restore the same posting context in a new immutable map version.
select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_economic_map(current_setting('test.tenant')::uuid)->>'id')::uuid,123456,1,(select map from economic_maps where id=current_setting('test.map')::uuid));
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005653')->>'debitOre','20000','one confirmed legacy full export is a valid baseline');
reset role;
insert into economic_sends(id,tenant_id,export_id,agreement_number,journal_number,status,voucher_number,actor,completed_at)
 values(gen_random_uuid(),current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005662',123456,1,'sent',52,'f0000000-0000-4000-8000-000000005641',now());
set local role authenticated;
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005653')->>'blockedReason','ECONOMIC_DAY_HISTORY_REVIEW','two legacy full exports need manual history reconciliation');
select throws_like($$select export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005653')$$,'%ECONOMIC_DAY_HISTORY_REVIEW%','ambiguous historic exports cannot create a correcting financial write');
select is((select count(*) from economic_exports where target_voucher is null and tenant_id=current_setting('test.tenant')::uuid),2::bigint,'legacy snapshots have not been rewritten');
reset role;
select * from finish();
rollback;
