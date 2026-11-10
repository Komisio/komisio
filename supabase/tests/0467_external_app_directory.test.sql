begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4670000-0000-4000-8000-000000000001','central-owner@example.test',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f4670000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic central','synthetic-central',gen_random_uuid()) as tenant \gset
select create_tenant_with_currency('Other currency','central-eur',gen_random_uuid(),'EUR') as other \gset
select current_store_policy(:'tenant')->'policy' as body \gset
select gen_random_uuid() as policy_id \gset
select publish_store_policy(:'tenant',:'policy_id',null,:'body'::jsonb || '{"externalAppSubmissionsEnabled":true,"photoSubmissionsEnabled":false}');
select throws_ok($$select host_central_app_intake()$$,'42501','FORBIDDEN','ordinary store owner cannot administer central intake');
set local role anon;
select is(public_central_app_recipient(),null::jsonb,'no implicit recipient by name or legacy checkbox');
select is(public_external_app_stores()->'stores','[]'::jsonb,'legacy checkbox grants no discovery');
select throws_ok($$select * from platform_settings$$,'42501',null,'platform settings are private');
reset role;
insert into public.platform_hosts(user_id) values('f4670000-0000-4000-8000-000000000001');
set local role authenticated;
select host_central_app_intake()->>'revision' as revision \gset
select gen_random_uuid() as command \gset
select throws_like(format($$select set_central_app_intake(gen_random_uuid(),%L,%L)$$,:'revision',:'other'),'%SEK_REQUIRED%','host cannot enable a foreign-currency recipient');
select lives_ok(format($$select set_central_app_intake(%L,%L,%L)$$,:'command',:'revision',:'tenant'),'host owner explicitly selects central tenant');
select lives_ok(format($$select set_central_app_intake(%L,%L,%L)$$,:'command',:'revision',:'tenant'),'exact configuration retry is harmless');
select throws_like(format($$select set_central_app_intake(%L,%L,null)$$,:'command',:'revision'),'%REQUEST_CONFLICT%','retry cannot change recipient');
select throws_like(format($$select set_central_app_intake(gen_random_uuid(),%L,null)$$,:'revision'),'%REQUEST_CHANGED%','stale host form cannot replace current choice');
select is((select count(*) from jsonb_array_elements(public_app_stores()) where value->>'id'=:'tenant'),0::bigint,'normal app directory is independent');
set local role anon;
select is(public_central_app_recipient(),jsonb_build_object('id',:'tenant','name','Komisio','slug','synthetic-central','city',null,'country','SE','currency','SEK'),'minimal public recipient uses product brand and SEK');
select is(jsonb_array_length(public_external_app_stores()->'stores'),1,'old directory exposes only central recipient');
select is(public_external_app_stores('',25,0,:'other')->'stores','[]'::jsonb,'a guessed tenant cannot bypass selection');
select is(public_external_app_stores('',1,1)->'stores','[]'::jsonb,'pagination remains bounded');
select is(jsonb_array_length(public_external_app_stores(' komisio ')->'stores'),1,'brand search trims whitespace');
select is(public_external_app_stores('%')->'stores','[]'::jsonb,'wildcards remain literal');
select throws_like($$select public_external_app_stores(null)$$,'%INVALID_INPUT%','null query rejected');
select throws_like($$select public_external_app_stores('',51)$$,'%INVALID_INPUT%','oversized page rejected');
select throws_like($$select public_external_app_stores('',25,-1)$$,'%INVALID_INPUT%','negative offset rejected');
set local role authenticated;
select publish_store_policy(:'tenant',gen_random_uuid(),:'policy_id',:'body'::jsonb || '{"externalAppSubmissionsEnabled":false,"photoSubmissionsEnabled":false}');
select is(public_central_app_recipient()->>'id',:'tenant','ordinary policy cannot revoke or grant central designation');
select is(current_store_policy(:'tenant')#>>'{policy,photoSubmissionsEnabled}','false','photo pre-review remains independent');
select set_central_app_intake(gen_random_uuid(),:'command',null);
set local role anon;
select is(public_central_app_recipient(),null::jsonb,'host pause immediately removes central discovery');
select * from finish();
rollback;
