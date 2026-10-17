begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.fortnox_scheduled_at('2026-01-15','07:00'), '2026-01-15 06:00Z'::timestamptz, 'winter uses Stockholm time');
select is(komisio_private.fortnox_scheduled_at('2026-07-15','07:00'), '2026-07-15 05:00Z'::timestamptz, 'summer uses Stockholm time');
select is(komisio_private.fortnox_scheduled_at('2026-03-29','02:37'), '2026-03-29 01:00Z'::timestamptz, 'missing spring time runs at first valid minute after it');
select is(komisio_private.fortnox_scheduled_at('2026-10-25','02:37'), '2026-10-25 00:37Z'::timestamptz, 'repeated autumn time uses its first occurrence');
select is(komisio_private.fortnox_scheduled_at('2026-01-15','23:59'), '2026-01-15 22:59Z'::timestamptz, 'arbitrary minute accepted');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000003471','schedule-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000003472','schedule-admin@example.test',now()),
 ('f0000000-0000-4000-8000-000000003473','schedule-worker@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003471","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Schedule test','schedule-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Schedule other','schedule-other',gen_random_uuid())::text,true);
select is(fortnox_send_schedule(current_setting('test.tenant')::uuid)->>'time','07:00','unset default is seven Stockholm');
reset role;
select is(komisio_private.fortnox_daily_due(current_setting('test.tenant')::uuid,'2026-01-15 05:59Z'),null::jsonb,'not due before configured time');
select is((komisio_private.fortnox_daily_due(current_setting('test.tenant')::uuid,'2026-01-15 12:00Z')->>'cutoff')::timestamptz,'2026-01-15 06:00Z'::timestamptz,'delayed tick retains scheduled cutoff');
insert into public.tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003472','admin');
set local role authenticated;
select throws_like(format('select save_fortnox_send_schedule(%L,gen_random_uuid(),null,%L)',current_setting('test.tenant'),v),'%INVALID_INPUT%','invalid time refused: '||coalesce(v,'null'))
 from unnest(array['7:00','24:00','12:60','00:00:00',' 07:00','bad',null]) v;
select set_config('test.schedule',gen_random_uuid()::text,true);
select is(save_fortnox_send_schedule(current_setting('test.tenant')::uuid,current_setting('test.schedule')::uuid,null,'00:00')->>'time','00:00','owner saves midnight before enabling');
select is(save_fortnox_send_schedule(current_setting('test.tenant')::uuid,current_setting('test.schedule')::uuid,null,'00:00')->>'id',current_setting('test.schedule'),'exact retry retains result');
select throws_like($$select save_fortnox_send_schedule(current_setting('test.tenant')::uuid,current_setting('test.schedule')::uuid,null,'00:01')$$,'%REQUEST_CONFLICT%','changed retry refused');
select throws_like($$select save_fortnox_send_schedule(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'00:01')$$,'%FORTNOX_SCHEDULE_CHANGED%','stale form refused');
select is((select count(*) from fortnox_schedule_revisions where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'retry creates no duplicate revision');
select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'fortnox_send','schedule-worker@example.test');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003472","role":"authenticated"}';
select is(fortnox_send_schedule(current_setting('test.tenant')::uuid)->>'time','00:00','admin can see time');
select throws_ok($$select save_fortnox_send_schedule(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.schedule')::uuid,'11:22')$$,'42501',null,'admin cannot change time');
select throws_ok($$select fortnox_send_schedule(current_setting('test.other')::uuid)$$,'42501',null,'other store cannot be read');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003473","role":"authenticated"}';
select accept_automation_grants();
select throws_ok($$select save_fortnox_send_schedule(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.schedule')::uuid,'11:22')$$,'42501',null,'worker cannot change time');
select set_config('test.run',gen_random_uuid()::text,true);
select ok(begin_fortnox_automatic_run(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid),'first daily claim succeeds');
select ok(not begin_fortnox_automatic_run(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid),'claim replay cannot dispatch');
select ok(not begin_fortnox_automatic_run(current_setting('test.tenant')::uuid,gen_random_uuid()),'second worker cannot dispatch');
select is(fortnox_automation_tenants(),'[]'::jsonb,'active claim removed from due queue');
select finish_fortnox_automatic_run(current_setting('test.tenant')::uuid,current_setting('test.run')::uuid,'partial',0);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003471","role":"authenticated"}';
select save_fortnox_send_schedule(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.schedule')::uuid,'23:59');
select is(fortnox_send_schedule(current_setting('test.tenant')::uuid)->>'time','23:59','any valid minute can be saved');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003473","role":"authenticated"}';
select set_config('test.next_run',gen_random_uuid()::text,true);
select ok(begin_fortnox_automatic_run(current_setting('test.tenant')::uuid,current_setting('test.next_run')::uuid),'partial resumes despite later setting change');
reset role;
select is((select detail->>'cutoff' from access_events where action='fortnox.automatic_started' and target_id=current_setting('test.next_run')::uuid),
 (select detail->>'cutoff' from access_events where action='fortnox.automatic_started' and target_id=current_setting('test.run')::uuid),'partial keeps original cutoff');
set local role authenticated;
select finish_fortnox_automatic_run(current_setting('test.tenant')::uuid,current_setting('test.next_run')::uuid,'complete',0);
select ok(not begin_fortnox_automatic_run(current_setting('test.tenant')::uuid,gen_random_uuid()),'completed day cannot repeat');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003471","role":"authenticated"}';
select disable_automation(current_setting('test.tenant')::uuid,'fortnox_send');
select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'fortnox_send','schedule-worker@example.test');
select is(fortnox_send_schedule(current_setting('test.tenant')::uuid)->>'time','23:59','grant renewal retains chosen time');
select is(fortnox_send_schedule(current_setting('test.other')::uuid)->>'time','07:00','other store unchanged');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003473","role":"authenticated"}';
select accept_automation_grants();
select ok(not begin_fortnox_automatic_run(current_setting('test.tenant')::uuid,gen_random_uuid()),'renewing grant cannot repeat completed day');
reset role;
-- Explicit synthetic completion evidence on the DST date, with no provider calls.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003471","role":"authenticated"}';
select save_fortnox_send_schedule(current_setting('test.other')::uuid,gen_random_uuid(),null,'02:37');
reset role;
select is(komisio_private.fortnox_daily_due(current_setting('test.other')::uuid,'2026-03-29 00:59Z'),null::jsonb,'spring day is not due before the gap ends');
select is((komisio_private.fortnox_daily_due(current_setting('test.other')::uuid,'2026-03-29 01:00Z')->>'cutoff')::timestamptz,'2026-03-29 01:00Z'::timestamptz,'spring day becomes due at first valid minute');
select is((komisio_private.fortnox_daily_due(current_setting('test.other')::uuid,'2026-10-25 00:37Z')->>'cutoff')::timestamptz,'2026-10-25 00:37Z'::timestamptz,'autumn day is due at first occurrence');
insert into public.access_events(tenant_id,actor_id,action,target_id,detail,occurred_at)
 values(current_setting('test.other')::uuid,'f0000000-0000-4000-8000-000000003473','fortnox.automatic_run',gen_random_uuid(),'{"day":"2026-10-25","outcome":"complete","sent":0}','2026-10-25 00:37Z');
select is(komisio_private.fortnox_daily_due(current_setting('test.other')::uuid,'2026-10-25 01:37Z'),null::jsonb,'repeated hour cannot repeat completed local day');
select is(komisio_private.fortnox_daily_due(current_setting('test.other')::uuid,'2026-10-25 12:00Z'),null::jsonb,'later tick cannot repeat completed local day');
select * from finish();
rollback;
