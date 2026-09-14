begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000451','plan-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000452','plan-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000453','plan-owner-two@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000451","role":"authenticated"}';
-- Billing off: a store created now has no plan row and is writable; the status says so.
select set_config('test.t1',create_tenant('Plan test one','plan-test-one',gen_random_uuid())::text,true);
select is((select count(*) from tenant_plans where tenant_id=current_setting('test.t1')::uuid),0::bigint,'no plan row while billing is off');
select is((plan_status(current_setting('test.t1')::uuid)->>'billing')::boolean,false,'status reports billing off');
select lives_ok($$select register_seller(current_setting('test.t1')::uuid,gen_random_uuid(),'Seller one','one@plan.test','')$$,'writes are open without billing');
select throws_like($$select close_store(current_setting('test.t1')::uuid,'done')$$,'%BILLING_DISABLED%','closing needs billing');
-- The host turns billing on: existing stores become active on a manual plan.
reset role;
select is((komisio_private.enable_billing('f0000000-0000-4000-8000-000000000452')->>'existingStoresActivated')::int,1,'existing store activated at billing start');
set local role authenticated;
select is(plan_status(current_setting('test.t1')::uuid)->>'state','active','existing store is active');
select is(plan_status(current_setting('test.t1')::uuid)->>'provider','manual','on a manual plan');
-- A new store starts a 30-day trial.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000453","role":"authenticated"}';
select set_config('test.t2',create_tenant('Plan test two','plan-test-two',gen_random_uuid())::text,true);
select is(plan_status(current_setting('test.t2')::uuid)->>'state','trial','new store is on trial');
select ok((plan_status(current_setting('test.t2')::uuid)->>'daysLeft')::int between 29 and 30,'about thirty days left');
select is((select kind from tenant_plan_events where tenant_id=current_setting('test.t2')::uuid),'trial_started','trial start recorded');
select lives_ok($$select register_seller(current_setting('test.t2')::uuid,gen_random_uuid(),'Seller two','two@plan.test','')$$,'trial stores write');
select throws_ok($$update tenant_plans set state='active' where tenant_id=current_setting('test.t2')::uuid$$,'42501',null,'members cannot change the plan');
select throws_ok($$select activate_plan_manually(current_setting('test.t2')::uuid,null,'please')$$,'42501',null,'an owner is not a host');
-- The trial ends: the daily run makes the store read-only; reads and the status keep working, new facts are refused.
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set trial_ends_at=now()-interval '1 minute' where tenant_id=current_setting('test.t2')::uuid;
select set_config('komisio.plan_transition','',true);
select is((komisio_private.expire_plans()->>'expired')::int,1,'one trial expired');
set local role authenticated;
select is(plan_status(current_setting('test.t2')::uuid)->>'state','read_only','store is read-only');
select is((plan_status(current_setting('test.t2')::uuid)->>'writable')::boolean,false,'and says it is not writable');
select throws_like($$select register_seller(current_setting('test.t2')::uuid,gen_random_uuid(),'Seller three','three@plan.test','')$$,'%PLAN_READ_ONLY%','a new seller is refused');
select throws_like($$select receive_bag(current_setting('test.t2')::uuid,gen_random_uuid(),(select id from sellers where tenant_id=current_setting('test.t2')::uuid limit 1),'')$$,'%PLAN_READ_ONLY%','a new bag is refused');
select lives_ok($$select economy_summary(current_setting('test.t2')::uuid,'2026-09-01','2026-09-30')$$,'reads still work');
select lives_ok($$select list_members(current_setting('test.t2')::uuid)$$,'membership reads still work');
select is((select actor from tenant_plan_events where tenant_id=current_setting('test.t2')::uuid and kind='trial_expired'),'f0000000-0000-4000-8000-000000000453'::uuid,'expiry carries the person who started the trial as actor');
-- The host activates by hand; the store writes again; a dated activation expires like a trial.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000452","role":"authenticated"}';
select is(is_platform_host(),true,'host recognised');
select is((select count(*) from host_plan_overview()),2::bigint,'host sees every store');
select throws_like($$select activate_plan_manually(current_setting('test.t2')::uuid,now()-interval '1 day','past')$$,'%INVALID_INPUT%','activation end must be in the future');
select is(activate_plan_manually(current_setting('test.t2')::uuid,now()+interval '1 day','invoice customer')->>'state','active','host activated');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000453","role":"authenticated"}';
select lives_ok($$select register_seller(current_setting('test.t2')::uuid,gen_random_uuid(),'Seller four','four@plan.test','')$$,'writes are open again');
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set active_until=now()-interval '1 minute' where tenant_id=current_setting('test.t2')::uuid;
select set_config('komisio.plan_transition','',true);
select is((komisio_private.expire_plans()->>'expired')::int,1,'dated activation expired');
select is((select count(*) from tenant_plan_events where tenant_id=current_setting('test.t2')::uuid and kind='activation_expired'),1::bigint,'recorded as activation expiry');
-- Closing: owner only; closed stores stay closed for the host too.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000451","role":"authenticated"}';
select throws_ok($$select close_store(current_setting('test.t2')::uuid,'not mine')$$,'42501',null,'outsider cannot close');
select is(close_store(current_setting('test.t1')::uuid,'moving on')->>'state','closed','owner closes the store');
select throws_like($$select register_seller(current_setting('test.t1')::uuid,gen_random_uuid(),'Late','late@plan.test','')$$,'%PLAN_READ_ONLY%','closed store refuses new facts');
select lives_ok($$select seller_data_export(current_setting('test.t1')::uuid,(select id from sellers where tenant_id=current_setting('test.t1')::uuid limit 1))$$,'export stays open after closing');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000452","role":"authenticated"}';
select throws_like($$select activate_plan_manually(current_setting('test.t1')::uuid,null,'reopen')$$,'%PLAN_CLOSED%','a closed store is not reactivated by the host');
select throws_ok($$select * from platform_settings$$,'42501',null,'settings are not readable');
select * from finish();
rollback;
