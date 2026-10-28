begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d4340000-0000-4000-8000-000000000001','app-owner@example.test',now()),
 ('d4340000-0000-4000-8000-000000000002','app-staff@example.test',now()),
 ('d4340000-0000-4000-8000-000000000003','app-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d4340000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Synthetic app store','app-store',gen_random_uuid())::text,true);
select set_config('test.hidden',create_tenant('Synthetic hidden store','hidden-store',gen_random_uuid())::text,true);
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'d4340000-0000-4000-8000-000000000002','staff');
set local role authenticated;
select is(store_app_visibility(current_setting('test.tenant')::uuid)->>'visible','false','stores are hidden from the app by default');
select is((store_app_visibility(current_setting('test.tenant')::uuid)->>'version')::integer,0,'no version before the first change');
select is(public_app_stores(),'[]'::jsonb,'no store is listed before opting in');
-- Publish, replay, conflict, stale.
select set_config('test.v1',gen_random_uuid()::text,true);
select is(set_store_app_visibility(current_setting('test.tenant')::uuid,current_setting('test.v1')::uuid,null,true),current_setting('test.v1')::uuid,'owner shows the store in the app');
select is(set_store_app_visibility(current_setting('test.tenant')::uuid,current_setting('test.v1')::uuid,null,true),current_setting('test.v1')::uuid,'replay returns the same version');
select throws_like($$select set_store_app_visibility(current_setting('test.tenant')::uuid,current_setting('test.v1')::uuid,null,false)$$,'%REQUEST_CONFLICT%','same id with another value refused');
select throws_like($$select set_store_app_visibility(current_setting('test.tenant')::uuid,gen_random_uuid(),null,false)$$,'%PROFILE_CHANGED%','change without naming the current version refused');
select throws_like($$select set_store_app_visibility(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.v1')::uuid,null)$$,'%INVALID_INPUT%','visibility is required');
select is(store_app_visibility(current_setting('test.tenant')::uuid)->>'id',current_setting('test.v1'),'read names the current version');
select is((store_app_visibility(current_setting('test.tenant')::uuid)->>'version')::integer,1,'read carries the version number');
-- Roles.
set local "request.jwt.claims"='{"sub":"d4340000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(store_app_visibility(current_setting('test.tenant')::uuid)->>'visible','true','staff reads the setting');
select throws_ok($$select set_store_app_visibility(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.v1')::uuid,false)$$,'42501','FORBIDDEN','staff cannot change the setting');
set local "request.jwt.claims"='{"sub":"d4340000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select store_app_visibility(current_setting('test.tenant')::uuid)$$,'42501','FORBIDDEN','non-members cannot read the setting');
select throws_ok($$select set_store_app_visibility(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.v1')::uuid,false)$$,'42501','FORBIDDEN','non-members cannot change the setting');
-- Public read lists only visible stores, with name and slug only.
set local role anon;
select is(public_app_stores(),jsonb_build_array(jsonb_build_object('id',current_setting('test.tenant'),'name','Synthetic app store','slug','app-store')),'anonymous app lists only the visible store');
select throws_ok($$select store_app_visibility(current_setting('test.tenant')::uuid)$$,'42501',null,'anonymous cannot read the setting');
select throws_ok($$select set_store_app_visibility(current_setting('test.tenant')::uuid,gen_random_uuid(),null,true)$$,'42501',null,'anonymous cannot change the setting');
-- Hiding again follows the latest version.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d4340000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_store_app_visibility(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.v1')::uuid,false);
select is((store_app_visibility(current_setting('test.tenant')::uuid)->>'visible')::boolean,false,'owner hides the store again');
select is(public_app_stores(),'[]'::jsonb,'hidden store leaves the app list');
reset role;
select is((select count(*) from store_app_visibility_settings where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'every change is kept');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='store_app.visibility'),2::bigint,'every change is audited');
select throws_ok($$update store_app_visibility_settings set visible=true$$,'55000','IMMUTABLE_STORE_POLICY','setting history is immutable');
select throws_ok($$delete from store_app_visibility_settings$$,'55000','IMMUTABLE_STORE_POLICY','setting history cannot be deleted');
select * from finish();
rollback;
