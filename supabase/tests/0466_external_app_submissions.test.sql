begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4660000-0000-4000-8000-000000000001','external-app-owner@example.test',now()),
 ('f4660000-0000-4000-8000-000000000002','external-app-staff@example.test',now()),
 ('f4660000-0000-4000-8000-000000000003','external-app-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4660000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('External app setting','external-app-setting',gen_random_uuid()) as tenant \gset
select create_tenant('Other app setting','external-app-other',gen_random_uuid()) as other \gset
select current_store_policy(:'tenant')->'policy' as body \gset
select is(coalesce((:'body'::jsonb->>'externalAppSubmissionsEnabled')::boolean,false),false,'new stores have not opted in');
select gen_random_uuid() as legacy \gset
select publish_store_policy(:'tenant',:'legacy',null,:'body'::jsonb);
select is(coalesce((current_store_policy(:'tenant')->'policy'->>'externalAppSubmissionsEnabled')::boolean,false),false,'legacy policy stays opted out');
select lives_ok(format('select publish_store_policy(%L,%L,null,%L)',:'tenant',:'legacy',:'body'),'legacy publication replays without adding a flag');
select throws_like(format('select publish_store_policy(%L,gen_random_uuid(),%L,%L)',:'tenant',:'legacy',(:'body'::jsonb || jsonb_build_object('externalAppSubmissionsEnabled',bad))::text),'%INVALID_INPUT%',label)
from (values ('null'::jsonb,'null rejected'), ('"true"','string rejected'), ('1','number rejected'), ('[]','array rejected'), ('{}','object rejected')) invalid(bad,label);
select gen_random_uuid() as enabled \gset
select publish_store_policy(:'tenant',:'enabled',:'legacy',:'body'::jsonb || '{"externalAppSubmissionsEnabled":true,"photoSubmissionsEnabled":false}');
select is(current_store_policy(:'tenant')->'policy'->'externalAppSubmissionsEnabled','true'::jsonb,'owner opt-in persists');
select is(current_store_policy(:'tenant')->'policy'->'photoSubmissionsEnabled','false'::jsonb,'existing photo pre-review remains independent');
select is(coalesce((current_store_policy(:'other')->'policy'->>'externalAppSubmissionsEnabled')::boolean,false),false,'another store remains opted out');
select lives_ok(format('select publish_store_policy(%L,%L,%L,%L)',:'tenant',:'enabled',:'legacy',(:'body'::jsonb || '{"externalAppSubmissionsEnabled":true,"photoSubmissionsEnabled":false}')::text),'exact opt-in retry replays');
select throws_like(format('select publish_store_policy(%L,%L,%L,%L)',:'tenant',:'enabled',:'legacy',(:'body'::jsonb || '{"externalAppSubmissionsEnabled":false,"photoSubmissionsEnabled":false}')::text),'%REQUEST_CONFLICT%','changed retry cannot overwrite the saved opt-in');
select throws_like(format('select publish_store_policy(%L,gen_random_uuid(),%L,%L)',:'tenant',:'legacy',(:'body'::jsonb || '{"externalAppSubmissionsEnabled":false}')::text),'%POLICY_CHANGED%','stale form cannot overwrite a newer setting');
select throws_like(format('select publish_store_policy(%L,gen_random_uuid(),%L,%L)',:'tenant',:'enabled',(:'body'::jsonb || '{"externalAppSubmissionsEnabled":true,"unknown":true}')::text),'%INVALID_INPUT%','new flag does not weaken validation of other fields');
select gen_random_uuid() as disabled \gset
select publish_store_policy(:'tenant',:'disabled',:'enabled',:'body'::jsonb || '{"externalAppSubmissionsEnabled":false}');
select is(current_store_policy(:'tenant')->'policy'->'externalAppSubmissionsEnabled','false'::jsonb,'owner can opt out again');
select is((select policy->'externalAppSubmissionsEnabled' from public.store_policy_versions where id=:'enabled'),'true'::jsonb,'old opt-in remains in immutable history');
select is((select policy from public.store_policy_versions where id=:'legacy'),:'body'::jsonb,'historical policy has not been rewritten');
select is((select count(*) from jsonb_array_elements(public_app_stores()) where value->>'id'=:'tenant'),0::bigint,'saving the preference does not publish the store in the app');
reset role;
insert into public.tenant_members(tenant_id,user_id,role) values
 (:'tenant','f4660000-0000-4000-8000-000000000002','staff'),
 (:'tenant','f4660000-0000-4000-8000-000000000003','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4660000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(current_store_policy(:'tenant')->'policy'->'externalAppSubmissionsEnabled','false'::jsonb,'staff can read the setting');
select throws_like(format('select publish_store_policy(%L,gen_random_uuid(),%L,%L)',:'tenant',:'disabled',(:'body'::jsonb || '{"externalAppSubmissionsEnabled":true}')::text),'%FORBIDDEN%','staff cannot opt in');
select throws_like(format('select current_store_policy(%L)',:'other'),'%FORBIDDEN%','another store remains private');
set local "request.jwt.claims"='{"sub":"f4660000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like(format('select publish_store_policy(%L,gen_random_uuid(),%L,%L)',:'tenant',:'disabled',(:'body'::jsonb || '{"externalAppSubmissionsEnabled":true}')::text),'%FORBIDDEN%','readonly cannot opt in');
set local role anon;
select throws_ok(format('select current_store_policy(%L)',:'tenant'),'42501',null,'anonymous callers cannot read store policy');
select * from finish();
rollback;
