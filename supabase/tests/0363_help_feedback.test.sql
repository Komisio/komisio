begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.help_feedback'::regclass),'feedback has RLS');
select is((select count(*) from pg_policy where polrelid='public.help_feedback'::regclass),0::bigint,'no product read policy');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='help_feedback'),array['id','tenant_id','slug','locale','page','helpful','comment','created_at'],'only approved fields, no user identifier');
select ok(not has_function_privilege('anon','public.submit_help_feedback(uuid,text,text,text,boolean,text)','EXECUTE'),'anonymous cannot submit');
select ok(has_function_privilege('authenticated','public.submit_help_feedback(uuid,text,text,text,boolean,text)','EXECUTE'),'authenticated may call the guarded function');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000003631','help-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000003632','help-admin@example.test',now()),
 ('f0000000-0000-4000-8000-000000003633','help-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000003634','help-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000003635','help-outsider@example.test',now()),
 ('f0000000-0000-4000-8000-000000003636','help-automation@example.test',now());
insert into auth.users(id,is_anonymous) values ('f0000000-0000-4000-8000-000000003637',true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003631","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Help test','help-feedback-test',gen_random_uuid())::text,true);
select enable_automation(current_setting('test.tenant')::uuid,gen_random_uuid(),'zettle_pull','help-automation@example.test');
select set_config('test.printer',gen_random_uuid()::text,true);
select register_printer(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'Counter','tcp','192.0.2.10:9100','ZD420',203);
select set_config('test.pair',create_print_pairing_code(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)::text,true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003632','admin'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003633','staff'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000003634','readonly');
set local role authenticated;
select throws_ok($$select * from help_feedback$$,'42501',null,'authenticated cannot read comments');
select throws_ok($$insert into help_feedback(tenant_id,slug,locale,page,helpful) values(current_setting('test.tenant')::uuid,'labels','en','/help/labels',true)$$,'42501',null,'authenticated cannot insert directly');
select throws_ok($$update help_feedback set helpful=false$$,'42501',null,'authenticated cannot update');
select throws_ok($$delete from help_feedback$$,'42501',null,'authenticated cannot delete');
select lives_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/help/[topic]',true,E' \n Useful \t')$$,'owner submits');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003632","role":"authenticated"}';
select lives_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','sv','/intake/items/[id]',false,null)$$,'admin submits');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003633","role":"authenticated"}';
select lives_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','dk','/settings?tab=printing',true,E' \t\n')$$,'staff submits');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003634","role":"authenticated"}';
select lives_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','fi','/[page]',false,null)$$,'readonly submits');
select throws_like($$select submit_help_feedback(gen_random_uuid(),'labels','en','/members',true,null)$$,'%FORBIDDEN%','other tenant refused');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'Bad Slug','en','/members',true,null)$$,'%INVALID_INPUT%','slug validated');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,repeat('a',81),'en','/members',true,null)$$,'%INVALID_INPUT%','slug bounded');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','xx','/members',true,null)$$,'%INVALID_INPUT%','locale validated');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','https://example.test',true,null)$$,'%INVALID_INPUT%','external page refused');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/intake/items/secret-id',true,null)$$,'%INVALID_INPUT%','real identifiers cannot be stored');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members?email=private@example.test',true,null)$$,'%INVALID_INPUT%','arbitrary query refused');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/settings?tab=private',true,null)$$,'%INVALID_INPUT%','unknown tab refused');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,repeat('x',1001))$$,'%INVALID_INPUT%','comment bounded');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en',null,true,null)$$,'%INVALID_INPUT%','null page refused');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',null,null)$$,'%INVALID_INPUT%','null answer refused');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'f0000000-0000-4000-8000-000000003634','totp','verified',now(),now());
set local role authenticated;
select throws_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,null)$$,'42501',null,'verified MFA requires aal2 even through direct RPC');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003634","role":"authenticated","aal":"aal2"}';
select lives_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','it','/members',true,null)$$,'aal2 restores legitimate access');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003635","role":"authenticated"}';
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,null)$$,'%FORBIDDEN%','nonmember refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003636","role":"authenticated"}';
select accept_automation_grants();
select is(tenant_role(current_setting('test.tenant')::uuid),'automation','automation fixture is genuine');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,null)$$,'%FORBIDDEN%','automation refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003637","role":"authenticated","is_anonymous":true}';
select pair_print_device(current_setting('test.pair')::jsonb->>'code','Synthetic device','1.0.0');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,null)$$,'%FORBIDDEN%','device refused');
reset role;
select is((select comment from help_feedback where locale='en'),'Useful','comment trimmed');
select is((select comment from help_feedback where locale='dk'),null,'empty comment normalized');
insert into help_feedback(tenant_id,slug,locale,page,helpful,created_at)
 select current_setting('test.tenant')::uuid,'labels','en','/members',true,now()-interval '25 hours' from generate_series(1,200);
insert into help_feedback(tenant_id,slug,locale,page,helpful)
 select current_setting('test.tenant')::uuid,'labels','en','/members',true from generate_series(1,194);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000003631","role":"authenticated"}';
select lives_ok($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,null)$$,'200th recent answer allowed; older rows excluded');
select throws_like($$select submit_help_feedback(current_setting('test.tenant')::uuid,'labels','en','/members',true,null)$$,'%RATE_LIMITED%','201st answer refused');
set local role anon;
select throws_ok($$select * from help_feedback$$,'42501',null,'anonymous cannot read');
select throws_ok($$insert into help_feedback(tenant_id,slug,locale,page,helpful) values(current_setting('test.tenant')::uuid,'labels','en','/members',true)$$,'42501',null,'anonymous cannot insert');
reset role;
select * from finish();
rollback;
