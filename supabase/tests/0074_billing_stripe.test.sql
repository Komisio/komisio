begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000461','bill-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000462','bill-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000463','bill-actor@example.test',now());
reset role;
select komisio_private.enable_billing('f0000000-0000-4000-8000-000000000462');
select komisio_private.register_billing_actor('f0000000-0000-4000-8000-000000000463');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Billing test','billing-test',gen_random_uuid())::text,true);
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','trial','store starts on trial');
select is(billing_customer(current_setting('test.tenant')::uuid),null,'no customer before checkout');
-- Only the billing actor records events; a person host is not the billing actor and vice versa.
select throws_ok($$select record_billing_event('evt_1','checkout.session.completed',current_setting('test.tenant')::uuid,'cus_1','sub_1','active',null,'{}')$$,'42501',null,'owner cannot record billing events');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000462","role":"authenticated"}';
select throws_ok($$select record_billing_event('evt_1','checkout.session.completed',current_setting('test.tenant')::uuid,'cus_1','sub_1','active',null,'{}')$$,'42501',null,'a person host cannot record billing events');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select is(is_platform_host(),false,'the billing actor is not a person host');
select throws_ok($$select activate_plan_manually(current_setting('test.tenant')::uuid,null,'x')$$,'42501',null,'the billing actor cannot activate manually');
-- Checkout completed: active on Stripe with ids; replay by event id changes nothing.
select is(record_billing_event('evt_1','checkout.session.completed',current_setting('test.tenant')::uuid,'cus_1','sub_1','active',null,'{"mode":"subscription"}')->>'state','active','checkout activates');
select is((record_billing_event('evt_1','checkout.session.completed',current_setting('test.tenant')::uuid,'cus_1','sub_1','active',null,'{}')->>'replayed')::boolean,true,'same event replayed');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select is(plan_status(current_setting('test.tenant')::uuid)->>'provider','stripe','provider is stripe');
select is(plan_status(current_setting('test.tenant')::uuid)->>'trialEndsAt',null,'trial end cleared');
select is(billing_customer(current_setting('test.tenant')::uuid)->>'customerId','cus_1','owner reads the customer id');
select lives_ok($$select register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'S','s@bill.test','')$$,'active store writes');
-- Payment failed: past_due with a 14-day grace, resolved by subscription id alone; paid again: active.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select is(record_billing_event('evt_2','invoice.payment_failed',null,null,'sub_1','past_due',null,'{}')->>'state','past_due','failed payment found the tenant by subscription');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select ok((plan_status(current_setting('test.tenant')::uuid)->>'daysLeft')::int between 13 and 14,'grace of fourteen days');
select lives_ok($$select register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'T','t@bill.test','')$$,'store keeps working during grace');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select is(record_billing_event('evt_3','invoice.payment_failed',null,'cus_1',null,'past_due',null,'{}')->>'state','past_due','second failure keeps the original grace');
select is(record_billing_event('evt_4','invoice.paid',null,null,'sub_1','active',null,'{}')->>'state','active','payment restores active');
-- Cancel at period end keeps the store active until the date; the daily run then closes it.
select is(record_billing_event('evt_5','customer.subscription.updated',null,null,'sub_1','cancel_at_period_end',now()-interval '1 minute','{}')->>'state','active','cancel scheduled stays active');
reset role;
select is((komisio_private.expire_plans()->>'expired')::int,1,'period end passed: expiry run closes it');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000461","role":"authenticated"}';
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','free','free core after the paid period');
select lives_ok($$select register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'U','u@bill.test','')$$,'the free core keeps writing');
-- Subscription deleted on a closed store records the event but changes nothing; unknown ids are recorded as unmatched.
select close_store(current_setting('test.tenant')::uuid,'moving on');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000463","role":"authenticated"}';
select is(record_billing_event('evt_6','customer.subscription.deleted',null,null,'sub_1','read_only',null,'{}')->>'state','closed','closed store stays closed');
select is((record_billing_event('evt_7','invoice.paid',null,'cus_unknown','sub_unknown','active',null,'{}')->>'matched')::boolean,false,'unknown ids are unmatched');
select throws_like($$select record_billing_event('evt_8','x',null,null,null,'weird',null,'{}')$$,'%INVALID_INPUT%','unknown outcome refused');
reset role;
select is((select count(*) from billing_events),7::bigint,'every event recorded once');
select throws_ok($$delete from billing_events where id='evt_1'$$,'55000',null,'billing events are immutable');
select * from finish();
rollback;
