begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000401','fortnox-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000402','fortnox-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000401","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Fortnox test','fortnox-test',gen_random_uuid())::text,true);
select set_config('test.cipher','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',true);
select is((fortnox_connection_status(current_setting('test.tenant')::uuid)->>'connected')::boolean,false,'not connected yet');
select is(read_fortnox_connection(current_setting('test.tenant')::uuid),null,'no ciphertext to read');
select throws_like($$select store_fortnox_connection(current_setting('test.tenant')::uuid,'','Komisio Test','5561234567',current_setting('test.cipher')::jsonb,'bookkeeping',now()+interval '1 hour')$$,'%INVALID_INPUT%','database number required');
select throws_like($$select store_fortnox_connection(current_setting('test.tenant')::uuid,'123456','Komisio Test','5561234567','{"iv":"x"}'::jsonb,'bookkeeping',now()+interval '1 hour')$$,'%INVALID_INPUT%','ciphertext must carry iv, tag and data');
select is((store_fortnox_connection(current_setting('test.tenant')::uuid,'123456','Komisio Test','5561234567',current_setting('test.cipher')::jsonb,'companyinformation bookkeeping',now()+interval '1 hour')->>'replaced')::boolean,false,'first connection stored');
select is(fortnox_connection_status(current_setting('test.tenant')::uuid)->>'companyName','Komisio Test','status names the company');
select is(fortnox_connection_status(current_setting('test.tenant')::uuid)->'cipher',null,'status never carries the ciphertext');
select is(read_fortnox_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','ZGF0YQ==','the server read returns the ciphertext');
select is((select kind from fortnox_connection_events where tenant_id=current_setting('test.tenant')::uuid order by occurred_at limit 1),'connected','connection event recorded');
-- A refreshed token replaces the ciphertext; another company is refused.
select is((store_fortnox_connection(current_setting('test.tenant')::uuid,'123456','Komisio Test','5561234567','{"iv":"aWl2","tag":"dGFn","data":"bmV3"}'::jsonb,'bookkeeping',now()+interval '2 hours')->>'replaced')::boolean,true,'refresh replaces');
select is(read_fortnox_connection(current_setting('test.tenant')::uuid)->'cipher'->>'data','bmV3','new ciphertext stored');
select throws_like($$select store_fortnox_connection(current_setting('test.tenant')::uuid,'999999','Inority AB','5561234567',current_setting('test.cipher')::jsonb,'bookkeeping',now()+interval '1 hour')$$,'%FORTNOX_WRONG_COMPANY%','a token for another company database is refused while connected');
select is(fortnox_connection_status(current_setting('test.tenant')::uuid)->>'companyName','Komisio Test','still the test company');
select record_fortnox_check(current_setting('test.tenant')::uuid,'checked','{"company_name":"Komisio Test"}'::jsonb);
select throws_like($$select record_fortnox_check(current_setting('test.tenant')::uuid,'connected','{}'::jsonb)$$,'%INVALID_INPUT%','only check and refusal events from the application');
select is(jsonb_array_length(fortnox_connection_status(current_setting('test.tenant')::uuid)->'events'),3,'events listed newest first');
-- Staff and other tenants see nothing sensitive and cannot change the connection.
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000402','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000402","role":"authenticated"}';
select is((fortnox_connection_status(current_setting('test.tenant')::uuid)->>'connected')::boolean,true,'staff see the status');
select throws_ok($$select read_fortnox_connection(current_setting('test.tenant')::uuid)$$,'42501',null,'staff cannot read the ciphertext');
select throws_ok($$select disconnect_fortnox(current_setting('test.tenant')::uuid)$$,'42501',null,'staff cannot disconnect');
select throws_ok($$select fortnox_connection_status(gen_random_uuid())$$,'42501',null,'another tenant denied');
select throws_ok($$select * from fortnox_connections$$,'42501',null,'the table itself is not selectable');
-- Direct writes are refused even for a privileged role; the owner disconnects through the engine.
reset role;
select throws_ok($$update fortnox_connections set company_name='x'$$,'55000',null,'no direct update');
select throws_ok($$delete from fortnox_connections$$,'55000',null,'no direct delete');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000401","role":"authenticated"}';
select is(disconnect_fortnox(current_setting('test.tenant')::uuid),true,'owner disconnects');
select is(disconnect_fortnox(current_setting('test.tenant')::uuid),false,'second disconnect is a no-op');
select is((fortnox_connection_status(current_setting('test.tenant')::uuid)->>'connected')::boolean,false,'disconnected');
select is((select count(*) from fortnox_connection_events where tenant_id=current_setting('test.tenant')::uuid and kind='disconnected'),1::bigint,'disconnect recorded');
select * from finish();
rollback;
