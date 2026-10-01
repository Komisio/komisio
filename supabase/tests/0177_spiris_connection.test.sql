begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000431','spiris-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000432','spiris-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000431","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Spiris test','spiris-test',gen_random_uuid())::text,true);
select set_config('test.cipher','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',true);
select is((spiris_connection_status(current_setting('test.tenant')::uuid)->>'connected')::boolean,false,'not connected yet');
select is(read_spiris_connection(current_setting('test.tenant')::uuid),null,'no ciphertext to read');
select throws_like($$select store_spiris_connection(current_setting('test.tenant')::uuid,'','Komisio Test','5561234567','SEK',current_setting('test.cipher')::jsonb,'ea:api',now()+interval '1 hour')$$,'%INVALID_INPUT%','company key required');
select throws_like($$select store_spiris_connection(current_setting('test.tenant')::uuid,'5561234567','Komisio Test','5561234567','sek',current_setting('test.cipher')::jsonb,'ea:api',now()+interval '1 hour')$$,'%INVALID_INPUT%','currency must be an ISO code');
select throws_like($$select store_spiris_connection(current_setting('test.tenant')::uuid,'5561234567','Komisio Test','5561234567','SEK','{"iv":"x"}'::jsonb,'ea:api',now()+interval '1 hour')$$,'%INVALID_INPUT%','ciphertext must carry iv, tag and data');
select is((store_spiris_connection(current_setting('test.tenant')::uuid,'5561234567','Komisio Test','556123-4567','SEK',current_setting('test.cipher')::jsonb,'ea:api ea:accounting offline_access',now()+interval '1 hour')->>'replaced')::boolean,false,'first connection stored');
select is(spiris_connection_status(current_setting('test.tenant')::uuid)->>'companyName','Komisio Test','status names the company');
select is(spiris_connection_status(current_setting('test.tenant')::uuid)->>'currencyCode','SEK','status carries the company currency');
select is(spiris_connection_status(current_setting('test.tenant')::uuid)->'cipher',null,'status never carries the ciphertext');
select is(read_spiris_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','ZGF0YQ==','the server read returns the ciphertext');
select matches(read_spiris_connection(current_setting('test.tenant')::uuid)->>'revision','^[1-9][0-9]*$','the read carries a revision as a decimal string');
select is((select kind from spiris_connection_events where tenant_id=current_setting('test.tenant')::uuid order by occurred_at limit 1),'connected','connection event recorded');
-- A reconnect replaces the ciphertext and advances the revision; another company is refused.
select set_config('test.rev',read_spiris_connection(current_setting('test.tenant')::uuid)->>'revision',true);
select is((store_spiris_connection(current_setting('test.tenant')::uuid,'5561234567','Komisio Test','556123-4567','SEK','{"iv":"aWl2","tag":"dGFn","data":"bmV3"}'::jsonb,'ea:api',now()+interval '2 hours')->>'replaced')::boolean,true,'reconnect replaces');
select is(read_spiris_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','bmV3','new ciphertext stored');
select isnt(read_spiris_connection(current_setting('test.tenant')::uuid)->>'revision',current_setting('test.rev'),'reconnect advances the revision');
select throws_like($$select store_spiris_connection(current_setting('test.tenant')::uuid,'5569999999','Inority AB','5569999999','SEK',current_setting('test.cipher')::jsonb,'ea:api',now()+interval '1 hour')$$,'%SPIRIS_WRONG_COMPANY%','a token for another company is refused while connected');
select is(spiris_connection_status(current_setting('test.tenant')::uuid)->>'companyName','Komisio Test','still the test company');
-- Revision-bound renewal: a stale revision is refused as data and recorded; the current one refreshes.
select set_config('test.rev',read_spiris_connection(current_setting('test.tenant')::uuid)->>'revision',true);
select is(refresh_spiris_tokens(current_setting('test.tenant')::uuid,1,'{"iv":"aWl2","tag":"dGFn","data":"c3RhbGU="}'::jsonb,'ea:api',now()+interval '1 hour')->>'error','SPIRIS_CONNECTION_CHANGED','a stale revision is refused as data');
select is(read_spiris_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','bmV3','the stale renewal stored nothing');
select is((select count(*) from spiris_connection_events where tenant_id=current_setting('test.tenant')::uuid and kind='refused'),1::bigint,'the refusal is an event');
select set_config('test.ref',refresh_spiris_tokens(current_setting('test.tenant')::uuid,current_setting('test.rev')::bigint,'{"iv":"aWl2","tag":"dGFn","data":"cmVm"}'::jsonb,'ea:api',now()+interval '1 hour')::text,true);
select is(current_setting('test.ref')::jsonb->>'status','refreshed','the current revision refreshes');
select is(read_spiris_connection(current_setting('test.tenant')::uuid)->>'revision',current_setting('test.ref')::jsonb->>'revision','the read reports the new revision');
select is(read_spiris_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','cmVm','renewed ciphertext stored');
select throws_like($$select refresh_spiris_tokens(current_setting('test.tenant')::uuid,0,current_setting('test.cipher')::jsonb,'',now()+interval '1 hour')$$,'%INVALID_INPUT%','a revision below one is invalid');
select record_spiris_check(current_setting('test.tenant')::uuid,'checked','{"company_name":"Komisio Test"}'::jsonb);
select throws_like($$select record_spiris_check(current_setting('test.tenant')::uuid,'connected','{}'::jsonb)$$,'%INVALID_INPUT%','only check and refusal events from the application');
select is(jsonb_array_length(spiris_connection_status(current_setting('test.tenant')::uuid)->'events'),5,'events listed newest first');
-- Staff and other tenants see nothing sensitive and cannot change the connection.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000432','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000432","role":"authenticated"}';
select is((spiris_connection_status(current_setting('test.tenant')::uuid)->>'connected')::boolean,true,'staff see the status');
select throws_ok($$select read_spiris_connection(current_setting('test.tenant')::uuid)$$,'42501',null,'staff cannot read the ciphertext');
select throws_ok($$select refresh_spiris_tokens(current_setting('test.tenant')::uuid,1,current_setting('test.cipher')::jsonb,'',now()+interval '1 hour')$$,'42501',null,'staff cannot renew');
select throws_ok($$select disconnect_spiris(current_setting('test.tenant')::uuid)$$,'42501',null,'staff cannot disconnect');
select throws_ok($$select spiris_connection_status(gen_random_uuid())$$,'42501',null,'another tenant denied');
select throws_ok($$select * from spiris_connections$$,'42501',null,'the table itself is not selectable');
-- Direct writes are refused even for a privileged role; the owner disconnects through the engine.
reset role;
select throws_ok($$update spiris_connections set company_name='x'$$,'55000',null,'no direct update');
select throws_ok($$delete from spiris_connections$$,'55000',null,'no direct delete');
select throws_ok($$delete from spiris_connection_events$$,'55000',null,'events are immutable');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000431","role":"authenticated"}';
select is(disconnect_spiris(current_setting('test.tenant')::uuid),true,'owner disconnects');
select is(disconnect_spiris(current_setting('test.tenant')::uuid),false,'second disconnect is a no-op');
select is((spiris_connection_status(current_setting('test.tenant')::uuid)->>'connected')::boolean,false,'disconnected');
select throws_like($$select refresh_spiris_tokens(current_setting('test.tenant')::uuid,1,current_setting('test.cipher')::jsonb,'',now()+interval '1 hour')$$,'%SPIRIS_NOT_CONNECTED%','no renewal without a connection');
select is((select count(*) from spiris_connection_events where tenant_id=current_setting('test.tenant')::uuid and kind='disconnected'),1::bigint,'disconnect recorded');
select * from finish();
rollback;
