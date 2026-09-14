begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000441','auto-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000442','auto-admin@example.test',now()),
 ('f0000000-0000-4000-8000-000000000443','automation@example.test',now()),
 ('f0000000-0000-4000-8000-000000000444','impostor@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000441","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Automation test','automation-test',gen_random_uuid())::text,true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000442','admin');
select throws_ok($$insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000443','automation')$$,'55000',null,'no direct automation membership, even for the owner role');
set local role authenticated;
-- Only an owner enables; the grant names the identity and the scope.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000442","role":"authenticated"}';
select throws_ok($$select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'zettle_pull','automation@example.test')$$,'42501',null,'admin cannot enable automation');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000441","role":"authenticated"}';
select throws_like($$select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'anything','automation@example.test')$$,'%INVALID_INPUT%','unknown scope refused');
select set_config('test.g1',gen_random_uuid()::text,true);
select is((enable_automation(current_setting('test.tenant')::uuid,current_setting('test.g1')::uuid,'zettle_pull','Automation@Example.test')->>'accepted')::boolean,false,'grant created, not yet accepted');
select is(enable_automation(current_setting('test.tenant')::uuid,current_setting('test.g1')::uuid,'zettle_pull','automation@example.test')->>'id',current_setting('test.g1'),'replay by id');
select throws_like($$select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'zettle_pull','automation@example.test')$$,'%AUTOMATION_ALREADY_ENABLED%','one active grant per scope');
select is(jsonb_array_length(automation_status(current_setting('test.tenant')::uuid)),1,'status lists the grant');
-- Another user with a different e-mail accepts nothing; the named identity accepts and becomes a member.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000444","role":"authenticated"}';
select is(accept_automation_grants(),'[]'::jsonb,'an impostor gets no grant');
select throws_ok($$select automation_status(current_setting('test.tenant')::uuid)$$,'42501',null,'and cannot read the status');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000443","role":"authenticated"}';
select is(jsonb_array_length(accept_automation_grants()),1,'the identity accepts its grant');
select is(tenant_role(current_setting('test.tenant')::uuid),'automation','and holds the automation role');
reset role;
select is(komisio_private.automation_allowed(current_setting('test.tenant')::uuid,'zettle_pull'),true,'allowed for the granted scope');
select is(komisio_private.automation_allowed(current_setting('test.tenant')::uuid,'fortnox_send'),false,'not for another scope');
set local role authenticated;
select is(accept_automation_grants(),'[]'::jsonb,'accepting again is a no-op');
-- The automation role is a member for reads only; every owner/admin/staff command refuses it.
select throws_ok($$select automation_status(current_setting('test.tenant')::uuid)$$,'42501',null,'automation cannot read the grants');
select throws_ok($$select rename_tenant(current_setting('test.tenant')::uuid,'x')$$,'42501',null,'automation cannot rename the store');
select throws_ok($$select create_invitation(current_setting('test.tenant')::uuid,'x@example.test','staff',repeat('a',64))$$,'42501',null,'automation cannot invite');
select throws_ok($$select economy_summary(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')$$,'42501',null,'member reads that list roles do not include automation');
-- Owner administration never touches the automation member; disabling removes it.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000441","role":"authenticated"}';
select throws_like($$select change_member(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000443','staff')$$,'%AUTOMATION_MEMBERSHIP%','role change refused');
select throws_like($$select change_member(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000443',null)$$,'%AUTOMATION_MEMBERSHIP%','removal through member admin refused');
select throws_like($$select change_member(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000442','automation')$$,'%INVALID_INPUT%','nobody is promoted to automation');
select is(disable_automation(current_setting('test.tenant')::uuid,'zettle_pull'),true,'owner disables');
select is(disable_automation(current_setting('test.tenant')::uuid,'zettle_pull'),false,'second disable is a no-op');
select is((select count(*) from tenant_members where tenant_id=current_setting('test.tenant')::uuid and role='automation'),0::bigint,'membership removed with the last grant');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action like 'automation.%'),3::bigint,'enabled, accepted and disabled are access events');
-- A person who is already a member cannot double as the automation identity.
select set_config('test.g2',gen_random_uuid()::text,true);
select enable_automation(current_setting('test.tenant')::uuid,current_setting('test.g2')::uuid,'zettle_pull','auto-admin@example.test');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000442","role":"authenticated"}';
select throws_like($$select accept_automation_grants()$$,'%AUTOMATION_IDENTITY_IS_MEMBER%','an existing member cannot accept an automation grant');
select * from finish();
rollback;
