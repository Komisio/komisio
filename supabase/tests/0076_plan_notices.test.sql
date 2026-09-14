begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000471','notice-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000472','notice-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000473','notice-actor@example.test',now()),
 ('f0000000-0000-4000-8000-000000000474','notice-staff@example.test',now());
reset role;
select komisio_private.enable_billing('f0000000-0000-4000-8000-000000000472');
select komisio_private.register_billing_actor('f0000000-0000-4000-8000-000000000473');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000471","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Notice test','notice-test',gen_random_uuid())::text,true);
select throws_ok($$select * from due_plan_notices()$$,'42501',null,'owner cannot list due notices');
-- Fresh trial: nothing due. Trial ending in six days: the week notice, addressed to the owner.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000473","role":"authenticated"}';
select is((select count(*) from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'nothing due on day one');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000474','staff');
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set trial_ends_at=now()+interval '6 days' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
set local role authenticated;
select is((select array_agg(kind order by kind) from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),array['trial_week'],'week notice due');
select is((select emails from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),array['notice-owner@example.test'],'addressed to the owner only');
select is((select locale from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),'sv','default locale');
select is(record_plan_notice(current_setting('test.tenant')::uuid,'trial_week',1,'sent'),true,'notice recorded');
select is(record_plan_notice(current_setting('test.tenant')::uuid,'trial_week',1,'sent'),false,'second record is a no-op');
select is((select count(*) from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'no longer due');
-- Tomorrow, then ended.
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set trial_ends_at=now()+interval '20 hours' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
set local role authenticated;
select is((select array_agg(kind) from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),array['trial_tomorrow'],'tomorrow notice due');
select record_plan_notice(current_setting('test.tenant')::uuid,'trial_tomorrow',1,'restricted');
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set trial_ends_at=now()-interval '1 hour' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
select komisio_private.expire_plans();
set local role authenticated;
select is((select array_agg(kind) from due_plan_notices() where tenant_id=current_setting('test.tenant')::uuid),array['trial_ended'],'ended notice due after expiry');
select throws_like($$select record_plan_notice(current_setting('test.tenant')::uuid,'trial_ended',1,'maybe')$$,'%INVALID_INPUT%','unknown delivery refused');
select record_plan_notice(current_setting('test.tenant')::uuid,'trial_ended',1,'sent');
-- Staff cannot read the log; the owner can; nobody edits it.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000474","role":"authenticated"}';
select is((select count(*) from plan_notices where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'staff see no notices');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000471","role":"authenticated"}';
select is((select count(*) from plan_notices where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'owner sees the three notices');
reset role;
select throws_ok($$delete from plan_notices$$,'55000',null,'notices are immutable');
select * from finish();
rollback;
