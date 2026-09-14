begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.phone_key('070-123 45 67'),'701234567','domestic number without the trunk zero');
select is(komisio_private.phone_key('+46 70 123 45 67'),'701234567','country prefix removed');
select is(komisio_private.phone_key('0046 (0)70 1234567'),'701234567','00 prefix and bracketed zero removed');
select is(komisio_private.phone_key(''),'','empty stays empty');
select is(komisio_private.phone_key(null),'','null stays empty');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000494','sm-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000495','sm-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000000496','sm-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000494","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Seller matches test','seller-matches-test',gen_random_uuid())::text,true);
select set_config('test.s1',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','anna@sm.test','')::text,true);
select set_config('test.s2',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Bo Berg','','070-123 45 67')::text,true);
select set_config('test.m',seller_matches(current_setting('test.tenant')::uuid,'Someone Else',' Anna@SM.test ','')::text,true);
select is(jsonb_array_length(current_setting('test.m')::jsonb->'matches'),1,'same e-mail matches');
select is(current_setting('test.m')::jsonb->'matches'->0->>'id',current_setting('test.s1'),'the existing seller');
select is(current_setting('test.m')::jsonb->'matches'->0->'reasons','["email"]'::jsonb,'for the e-mail');
select is(current_setting('test.m')::jsonb->'matches'->0->>'contact','anna@sm.test','contact shown');
select is(seller_matches(current_setting('test.tenant')::uuid,'','','+46 70 123 45 67')->'matches'->0->'reasons','["phone"]'::jsonb,'same phone in another notation');
select is(seller_matches(current_setting('test.tenant')::uuid,'anna andersson','other@sm.test','')->'matches'->0->'reasons','["name"]'::jsonb,'same name, case-insensitive');
select is(seller_matches(current_setting('test.tenant')::uuid,'Anna Andersson','anna@sm.test','')->'matches'->0->'reasons','["email","name"]'::jsonb,'every reason listed');
select is(seller_matches(current_setting('test.tenant')::uuid,'Anna Andersson','','0701234567')->'matches'->1->>'name','Bo Berg','several candidates, strongest first');
select is(seller_matches(current_setting('test.tenant')::uuid,'Nobody','nobody@sm.test','0709999999')->'matches','[]'::jsonb,'no match');
select is(seller_matches(current_setting('test.tenant')::uuid,'','','')->'matches','[]'::jsonb,'nothing typed matches nothing');
select throws_like($$select seller_matches(current_setting('test.tenant')::uuid,repeat('a',121),'','')$$,'%INVALID_INPUT%','too long refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000495','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000495","role":"authenticated"}';
select lives_ok($$select seller_matches(current_setting('test.tenant')::uuid,'','anna@sm.test','')$$,'read-only members may check');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000496","role":"authenticated"}';
select throws_ok($$select seller_matches(current_setting('test.tenant')::uuid,'','anna@sm.test','')$$,'42501',null,'outsider refused');
select throws_ok($$select komisio_private.phone_key('070')$$,'42501',null,'the helper is not callable by members');
select * from finish();
rollback;
