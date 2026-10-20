begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000005231','economic-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000005232','economic-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000005233','economic-admin@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005231","role":"authenticated"}';
select set_config('test.tenant',create_tenant_with_locale('Economic test','economic-test',gen_random_uuid(),'dk')::text,true);
select set_config('test.cipher','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',true);
select is(economic_connection_status(current_setting('test.tenant')::uuid)->>'connected','false','initially disconnected');
select store_economic_connection(current_setting('test.tenant')::uuid,123456,'Synthetic company','12345678','DKK',current_setting('test.cipher')::jsonb);
select is(economic_connection_status(current_setting('test.tenant')::uuid)->>'agreementNumber','123456','agreement pinned');
select is(economic_connection_status(current_setting('test.tenant')::uuid)->'cipher',null,'public status omits ciphertext');
select throws_like($$select store_economic_connection(current_setting('test.tenant')::uuid,999999,'Other','','DKK',current_setting('test.cipher')::jsonb)$$,'%ECONOMIC_WRONG_AGREEMENT%','cannot replace the pin');
select throws_like($$select store_economic_connection(current_setting('test.tenant')::uuid,123456,'Synthetic','','EUR',current_setting('test.cipher')::jsonb)$$,'%ECONOMIC_CURRENCY_UNSUPPORTED%','non-DKK refused');
select throws_ok($$select * from economic_connections$$,'42501',null,'no direct ciphertext grant');
select throws_like($$select store_economic_connection(current_setting('test.tenant')::uuid,123456,'Synthetic','','DKK','{"iv":null,"tag":"x","data":"x"}')$$,'%INVALID_INPUT%','cipher fields must be bounded strings');
select throws_like($$select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,123456,1,'{"grossOre":{"account":"not-a-number","side":"debit","vatCode":"Z0"}}')$$,'%INVALID_INPUT%','nonnumeric account fails with a safe input error');
select set_config('test.map',gen_random_uuid()::text,true);
select throws_like($$select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,123456,1,'{"grossOre":{"account":"10000","side":"debit","vatCode":""}}')$$,'%INVALID_INPUT%','empty VAT code refused');
select throws_like($$select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,123456,1,'{"mode:consignment_fee:vatOre":{"excludeReason":"Do not post"}}')$$,'%INVALID_INPUT%','fee exclusions refused');
select publish_economic_map(current_setting('test.tenant')::uuid,current_setting('test.map')::uuid,null,123456,1,
 '{"grossOre":{"account":"10000","side":"debit","vatCode":"Z0"},"commissionOre":{"account":"30000","side":"credit","vatCode":"Z0"}}');
-- Frozen synthetic close fixtures isolate mapping/send invariants from sale arithmetic.
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005232','staff'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005233','admin');
insert into day_closes(id,tenant_id,close_date,version,gross_ore,commission_ore,per_mode,generated_by)
 values ('f0000000-0000-4000-8000-000000005234',current_setting('test.tenant')::uuid,'2026-10-01',1,10000,10000,'{"store_full":{"netOre":10000}}','f0000000-0000-4000-8000-000000005231');
set local role authenticated;
select throws_like($$select export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005234')$$,'%ECONOMIC_MAP_INCOMPLETE%','balanced selection alone cannot silently omit overlaps');
select set_config('test.map2',gen_random_uuid()::text,true);
select publish_economic_map(current_setting('test.tenant')::uuid,current_setting('test.map2')::uuid,current_setting('test.map')::uuid,123456,1,
 '{"grossOre":{"account":"10000","side":"debit","vatCode":"Z0"},"commissionOre":{"account":"30000","side":"credit","vatCode":"Z0"},"mode:store_full:netOre":{"excludeReason":"Already included in commission total for this synthetic fixture"}}');
select set_config('test.export',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005234')::text,true);
select is(export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005234'),current_setting('test.export')::uuid,'one immutable export per close/map');
select is((select excluded->'mode:store_full:netOre'->>'reason' from economic_exports where id=current_setting('test.export')::uuid),'Already included in commission total for this synthetic fixture','exclusion explanation frozen');
select set_config('test.send',gen_random_uuid()::text,true);
select is(begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,current_setting('test.export')::uuid)->>'dispatchAllowed','true','fresh claim allows one dispatch');
select is(begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,current_setting('test.export')::uuid)->>'dispatchAllowed','false','replay cannot dispatch');
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%ECONOMIC_SEND_IN_PROGRESS%','second pending send refused');
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,'failed',null,'ECONOMIC_OUTCOME_UNKNOWN','ECONOMIC_MULTIPLE_VOUCHERS',null);
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%ECONOMIC_OUTCOME_UNKNOWN%','unknown send never retried');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005233","role":"authenticated"}';
select throws_ok($$select confirm_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,1,42,'Checked journal')$$,'42501',null,'admin cannot manually confirm');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005232","role":"authenticated"}';
select is(economic_connection_status(current_setting('test.tenant')::uuid)->>'connected','true','staff see connection');
select is((select count(*) from economic_sends),1::bigint,'staff read sends');
select throws_ok($$select read_economic_connection(current_setting('test.tenant')::uuid)$$,'42501',null,'staff cannot read ciphertext');
select throws_ok($$select disconnect_economic(current_setting('test.tenant')::uuid)$$,'42501',null,'staff cannot disconnect');
select throws_ok($$select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),null,123456,1,'{}')$$,'42501',null,'staff cannot map');
select throws_ok($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'42501',null,'staff cannot send');
select throws_ok($$select economic_connection_status(gen_random_uuid())$$,'42501',null,'other tenant status denied');
select throws_ok($$select preview_economic_voucher(gen_random_uuid(),'f0000000-0000-4000-8000-000000005234')$$,'42501',null,'other tenant preview denied');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005231","role":"authenticated"}';
select is(confirm_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,1,42,'Checked journal')->>'status','sent','owner records manual confirmation');
select is(confirm_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,1,42,'Checked journal')->>'status','sent','confirmation replay safe');
select throws_like($$select confirm_economic_send(current_setting('test.tenant')::uuid,current_setting('test.send')::uuid,1,43,'Different evidence')$$,'%REQUEST_CONFLICT%','conflicting confirmation refused');
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%ECONOMIC_ALREADY_SENT%','confirmed export cannot resend');
select is(economic_export_page(current_setting('test.tenant')::uuid,current_setting('test.export')::uuid)->0->'send'->>'status','sent','export page includes effective confirmation');
select throws_ok($$select economic_export_page(gen_random_uuid())$$,'42501',null,'export page enforces tenant membership');
-- A proven preflight failure releases the attempt, but respects Retry-After.
reset role;
insert into day_closes(id,tenant_id,close_date,version,gross_ore,commission_ore,generated_by)
 values ('f0000000-0000-4000-8000-000000005235',current_setting('test.tenant')::uuid,'2026-10-02',1,10000,10000,'f0000000-0000-4000-8000-000000005231');
set local role authenticated;
select set_config('test.retry_export',export_economic_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),'f0000000-0000-4000-8000-000000005235')::text,true);
select set_config('test.retry_send',gen_random_uuid()::text,true);
select begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.retry_send')::uuid,current_setting('test.retry_export')::uuid);
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.retry_send')::uuid,'failed',null,'ECONOMIC_PREFLIGHT_FAILED','ECONOMIC_ACCOUNT_INVALID',null);
select set_config('test.rate_send',gen_random_uuid()::text,true);
select is(begin_economic_send(current_setting('test.tenant')::uuid,current_setting('test.rate_send')::uuid,current_setting('test.retry_export')::uuid)->>'dispatchAllowed','true','proven preflight failure allows a new attempt');
select complete_economic_send(current_setting('test.tenant')::uuid,current_setting('test.rate_send')::uuid,'failed',null,'ECONOMIC_PREFLIGHT_FAILED','ECONOMIC_RATE_LIMITED',120);
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.retry_export')::uuid)$$,'%ECONOMIC_RATE_LIMITED%','provider Retry-After is enforced in the engine');
reset role;
insert into day_closes(id,tenant_id,close_date,version,per_mode,generated_by)
 values ('f0000000-0000-4000-8000-000000005237',current_setting('test.tenant')::uuid,'2026-10-03',1,
 '{"consignment_fee":{"grossOre":1250,"netOre":1000,"vatOre":250},"consignment_fee_reversal":{"grossOre":500,"netOre":400,"vatOre":100}}','f0000000-0000-4000-8000-000000005231');
set local role authenticated;
select is(jsonb_array_length(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005237')->'unmapped'),6,'every nonzero fee and reversal amount needs a map');
select publish_economic_map(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.map2')::uuid,123456,1,
 '{"mode:consignment_fee:grossOre":{"account":"10000","side":"debit","vatCode":"Z0"},"mode:consignment_fee:netOre":{"account":"30000","side":"credit","vatCode":"Z0"},"mode:consignment_fee:vatOre":{"account":"40000","side":"credit","vatCode":"Z0"},"mode:consignment_fee_reversal:grossOre":{"account":"10000","side":"credit","vatCode":"Z0"},"mode:consignment_fee_reversal:netOre":{"account":"30000","side":"debit","vatCode":"Z0"},"mode:consignment_fee_reversal:vatOre":{"account":"40000","side":"debit","vatCode":"Z0"}}');
select is(preview_economic_voucher(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000005237')->>'balanced','true','explicit fee and reversal lines balance without another VAT calculation');
select is(disconnect_economic(current_setting('test.tenant')::uuid),true,'owner disconnects');
select is(read_economic_connection(current_setting('test.tenant')::uuid),null,'stored grant removed');
reset role;
select throws_ok($$update economic_maps set journal_number=2$$,'55000',null,'map immutable');
select throws_ok($$delete from economic_exports$$,'55000',null,'export immutable');
select throws_ok($$delete from economic_send_events$$,'55000',null,'send evidence immutable');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'f0000000-0000-4000-8000-000000005231','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000005231","role":"authenticated","aal":"aal1"}';
select is((select count(*) from economic_exports),0::bigint,'MFA challenge hides export facts');
select throws_like($$select read_economic_connection(current_setting('test.tenant')::uuid)$$,'%AUTH_REQUIRED%','MFA challenge blocks credential access');
select throws_like($$select begin_economic_send(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.export')::uuid)$$,'%AUTH_REQUIRED%','MFA challenge blocks send even when already sent');
set local role anon;
select throws_ok($$select economic_export_page(null)$$,'42501',null,'anonymous cannot call export page');
reset role;
select * from finish();
rollback;
