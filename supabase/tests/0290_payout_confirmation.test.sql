begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('f0000000-0000-4000-8000-000000002901','confirm-owner@example.test',now()),
('f0000000-0000-4000-8000-000000002902','confirm-staff@example.test',now()),
('f0000000-0000-4000-8000-000000002903','confirm-reader@example.test',now()),
('f0000000-0000-4000-8000-000000002904','confirm-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002901","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Payout confirmation','payout-confirmation',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other payout confirmation','other-payout-confirmation',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic payee','payee@example.test','')::text,true);
select adjust_seller_ledger(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,500000,'Synthetic test balance');
select set_config('test.p1',gen_random_uuid()::text,true);
select set_config('test.p2',gen_random_uuid()::text,true);
select set_config('test.p3',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,10000);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p2')::uuid,current_setting('test.seller')::uuid,20000);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p3')::uuid,current_setting('test.seller')::uuid,10000);
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid);
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p2')::uuid);
select set_config('test.batch',gen_random_uuid()::text,true);
select set_config('test.rows',jsonb_build_array(
 jsonb_build_object('payoutId',current_setting('test.p1'),'amountOre',10000,'reference',' BANK-A '),
 jsonb_build_object('payoutId',current_setting('test.p2'),'amountOre',20000,'reference','BANK-B'))::text,true);
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK','[]')$$,'%INVALID_INPUT%','empty batch refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK','{}')$$,'%INVALID_INPUT%','non-array refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,null,'SEK',current_setting('test.rows')::jsonb)$$,'%INVALID_INPUT%','null identity refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'NOK',current_setting('test.rows')::jsonb)$$,'%PAYOUT_CHANGED%','currency mismatch refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{0,amountOre}','10001'))$$,'%PAYOUT_CHANGED%','changed amount refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{0,amountOre}','10000.5'))$$,'%INVALID_INPUT%','fractional minor units refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{0,reference}','" "'))$$,'%INVALID_INPUT%','actual reference required');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{0,payoutId}','"invalid"'))$$,'%INVALID_INPUT%','malformed ID refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{1,payoutId}',to_jsonb(current_setting('test.p1'))))$$,'%INVALID_INPUT%','duplicate payout refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{0,unexpected}','true'))$$,'%INVALID_INPUT%','unknown fields refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',(select jsonb_agg(current_setting('test.rows')::jsonb->0) from generate_series(1,51)))$$,'%INVALID_INPUT%','bounded batch');
select throws_like($$select confirm_payout_payments(current_setting('test.other')::uuid,gen_random_uuid(),'SEK',current_setting('test.rows')::jsonb)$$,'%PAYOUT_CHANGED%','cross-tenant payouts refused');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{1,payoutId}',to_jsonb(current_setting('test.p3'))))$$,'%PAYOUT_CHANGED%','unapproved row refuses whole batch');
select is((select count(*) from payouts where tenant_id=current_setting('test.tenant')::uuid and status='approved'),2::bigint,'failed batches change no statuses');
select is((select count(*) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid and kind='payout_paid'),0::bigint,'failed batches move no money');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='payout.payments_confirmed'),0::bigint,'failed batches leave no completed receipt');
reset role;
-- Force a failure after the first transition to verify whole-transaction rollback.
create function pg_temp.refuse_last_payment() returns trigger language plpgsql as $$
begin
 if new.kind='paid' and new.payout_id=greatest(current_setting('test.p1')::uuid,current_setting('test.p2')::uuid) then raise exception 'SYNTHETIC_PAYMENT_FAILURE'; end if;
 return new;
end $$;
create trigger test_payment_failure before insert on payout_events for each row execute function pg_temp.refuse_last_payment();
set local role authenticated;
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,'SEK',current_setting('test.rows')::jsonb)$$,'%SYNTHETIC_PAYMENT_FAILURE%','late failure rolls back the full transaction');
select is((select count(*) from payouts where tenant_id=current_setting('test.tenant')::uuid and status='approved'),2::bigint,'first payment transition rolled back');
select is((select count(*) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid and kind='payout_paid'),0::bigint,'first payment ledger rolled back');
reset role;
drop trigger test_payment_failure on payout_events;
set local role authenticated;
select is(confirm_payout_payments(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,'SEK',current_setting('test.rows')::jsonb),current_setting('test.batch')::uuid,'confirm two completed transfers');
select is((select count(*) from payouts where tenant_id=current_setting('test.tenant')::uuid and status='paid'),2::bigint,'both marked paid');
select is((select payment_reference from payouts where id=current_setting('test.p1')::uuid),'BANK-A','trimmed actual reference recorded');
select is((select payment_reference from payouts where id=current_setting('test.p2')::uuid),'BANK-B','individual references preserved');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'reservedOre')::bigint,0::bigint,'reservations settled');
select is((seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,470000::bigint,'no second deduction from available balance');
select is(confirm_payout_payments(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,'SEK',jsonb_build_array(current_setting('test.rows')::jsonb->1,jsonb_set(current_setting('test.rows')::jsonb->0,'{reference}','"BANK-A"'))),current_setting('test.batch')::uuid,'reordered and normalized retry is the same batch');
select is((select count(*) from seller_ledger_entries where tenant_id=current_setting('test.tenant')::uuid and kind='payout_paid'),2::bigint,'retry does not duplicate ledger');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='payout.payments_confirmed'),1::bigint,'retry has one receipt');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,'SEK',jsonb_set(current_setting('test.rows')::jsonb,'{0,reference}','"DIFFERENT"'))$$,'%REQUEST_CONFLICT%','same identity cannot change evidence');
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',current_setting('test.rows')::jsonb)$$,'%PAYOUT_CHANGED%','another command cannot repay paid payouts');
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p3')::uuid);
reset role;
insert into tenant_members(tenant_id,user_id,role) values
(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002902','staff'),
(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002903','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002902","role":"authenticated"}';
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,'SEK',current_setting('test.rows')::jsonb)$$,'%REQUEST_CONFLICT%','another staff member cannot replay as original actor');
select lives_ok($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',jsonb_build_array(jsonb_build_object('payoutId',current_setting('test.p3'),'amountOre',10000,'reference','BANK-C')))$$,'staff may record an approved payment');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002903","role":"authenticated"}';
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',current_setting('test.rows')::jsonb)$$,'%FORBIDDEN%','readonly refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002904","role":"authenticated"}';
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,gen_random_uuid(),'SEK',current_setting('test.rows')::jsonb)$$,'%FORBIDDEN%','outsider refused');
reset role;
select ok(not has_function_privilege('anon','public.confirm_payout_payments(uuid,uuid,text,jsonb)','execute'),'anonymous refused');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000002901','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002901","role":"authenticated","aal":"aal1"}';
select throws_like($$select confirm_payout_payments(current_setting('test.tenant')::uuid,current_setting('test.batch')::uuid,'SEK',current_setting('test.rows')::jsonb)$$,'%AUTH_REQUIRED%','MFA applies even to retries');
reset role;
select * from finish(); rollback;
