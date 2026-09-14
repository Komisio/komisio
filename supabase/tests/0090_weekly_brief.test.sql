begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000481','wb-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000482','wb-automation@example.test',now()),
 ('f0000000-0000-4000-8000-000000000483','wb-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000481","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Weekly brief test','weekly-brief-test',gen_random_uuid())::text,true);
-- Before any grant the automation identity is a stranger to the store.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000482","role":"authenticated"}';
select throws_ok($$select economy_brief(current_setting('test.tenant')::uuid,'week','2026-09-13')$$,'42501',null,'no brief without a grant');
select is((select count(*) from due_weekly_briefs('2026-09-14')),0::bigint,'nothing due without a grant');
select throws_like($$select * from due_weekly_briefs('2026-09-15')$$,'%INVALID_INPUT%','week start must be a Monday');
-- The owner enables the weekly brief; the identity accepts and may read the brief and the summary, nothing else.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000481","role":"authenticated"}';
select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'weekly_brief','wb-automation@example.test');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000482","role":"authenticated"}';
select is(jsonb_array_length(accept_automation_grants()),1,'grant accepted');
select lives_ok($$select economy_brief(current_setting('test.tenant')::uuid,'week','2026-09-13')$$,'brief readable with the scope');
select lives_ok($$select economy_summary(current_setting('test.tenant')::uuid,'2026-09-07','2026-09-13')$$,'summary readable with the scope');
select throws_ok($$select accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-07','2026-09-13')$$,'42501',null,'other reads stay closed');
select throws_ok($$select fortnox_connection_status(current_setting('test.tenant')::uuid)$$,'42501',null,'the scope opens nothing about Fortnox');
select is((select emails from due_weekly_briefs('2026-09-14')),array['wb-owner@example.test'],'due for the owner');
select is(record_brief_send(current_setting('test.tenant')::uuid,'2026-09-14',1,'sent'),true,'send recorded');
select is(record_brief_send(current_setting('test.tenant')::uuid,'2026-09-14',1,'sent'),false,'same week is a no-op');
select is((select count(*) from due_weekly_briefs('2026-09-14')),0::bigint,'no longer due this week');
select is((select count(*) from due_weekly_briefs('2026-09-21')),1::bigint,'due again next week');
-- Staff cannot record or read the log; the owner reads it; nobody edits it. Disabling closes the reads.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000483","role":"authenticated"}';
select throws_ok($$select record_brief_send(current_setting('test.tenant')::uuid,'2026-09-21',1,'sent')$$,'42501',null,'a stranger cannot record');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000481","role":"authenticated"}';
select is((select count(*) from brief_sends where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'owner sees the send');
select is(disable_automation(current_setting('test.tenant')::uuid,'weekly_brief'),true,'owner disables');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000482","role":"authenticated"}';
select throws_ok($$select economy_brief(current_setting('test.tenant')::uuid,'week','2026-09-13')$$,'42501',null,'brief closed again after disabling');
reset role;
select throws_ok($$delete from brief_sends$$,'55000',null,'send log is immutable');
select * from finish();
rollback;
