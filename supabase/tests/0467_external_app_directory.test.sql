begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4670000-0000-4000-8000-000000000001','external-directory-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4670000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic external A','synthetic-external-a',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic external B','synthetic-external-b',gen_random_uuid()) as other \gset
select create_tenant('Synthetic external C','synthetic-external-c',gen_random_uuid()) as hidden \gset
select current_store_policy(:'tenant')->'policy' as body \gset
select set_store_app_visibility(:'hidden',gen_random_uuid(),null,true);
select gen_random_uuid() as enabled \gset
select publish_store_policy(:'tenant',:'enabled',null,:'body'::jsonb || '{"externalAppSubmissionsEnabled":true,"photoSubmissionsEnabled":false,"currency":"NOK"}');
select publish_store_policy(:'other',gen_random_uuid(),null,:'body'::jsonb || '{"externalAppSubmissionsEnabled":true}');
select publish_store_profile(:'tenant',gen_random_uuid(),null,'{"address":{"street":"Private test street","postalCode":"12345","city":"Uppsala","country":"SE"},"contact":{"email":"store@example.test","phone":"","website":""},"openingHours":[],"accepts":"Test items","concept":"Test concept","language":"sv"}');
set local role anon;
select is(jsonb_array_length(public_external_app_stores('Synthetic external')->'stores'),2,'only explicit external opt-ins are listed');
select is(public_external_app_stores('Synthetic external')->'hasMore','false'::jsonb,'complete page has no next page');
select is(jsonb_array_length(public_external_app_stores('',25,0,:'hidden')->'stores'),0,'ordinary app visibility grants no external intake listing');
select is(public_external_app_stores('',25,0,:'tenant')->'stores'->0,
 jsonb_build_object('id',:'tenant','name','Synthetic external A','slug','synthetic-external-a','city','Uppsala','country','SE','currency','NOK'),
 'projection exposes only approved public fields and configured currency');
select is(public_external_app_stores('',25,0,:'other')->'stores'->0->'city','null'::jsonb,'missing profile does not invent a city');
select is(public_external_app_stores('',25,0,:'other')->'stores'->0->'country','null'::jsonb,'country is never inferred from currency');
select is(public_external_app_stores('',25,0,:'other')->'stores'->0->>'currency','SEK','existing policy currency default is retained');
select is(jsonb_array_length(public_external_app_stores('uppSALA')->'stores'),1,'search matches public city without case sensitivity');
select is(jsonb_array_length(public_external_app_stores('  Synthetic external A  ')->'stores'),1,'search trims whitespace');
select is(jsonb_array_length(public_external_app_stores('%')->'stores'),0,'percent is literal');
select is(jsonb_array_length(public_external_app_stores('_')->'stores'),0,'underscore is literal');
select is(public_external_app_stores('Synthetic external',1,0)->'stores'->0->>'id',:'tenant','first page is ordered');
select is(public_external_app_stores('Synthetic external',1,0)->'hasMore','true'::jsonb,'bounded page reports a following page');
select is(public_external_app_stores('Synthetic external',1,1)->'stores'->0->>'id',:'other','second page includes the next store');
select is(public_external_app_stores('Synthetic external',1,1)->'hasMore','false'::jsonb,'last page has no next page');
select is(public_external_app_stores('Synthetic external',1,2)->'stores','[]'::jsonb,'past the end returns an empty page');
select is(public_external_app_stores('',25,0,'f4670000-0000-4000-8000-000000000099')->'stores','[]'::jsonb,'unknown identity returns no store');
select throws_like($$select public_external_app_stores(null)$$,'%INVALID_INPUT%','null query rejected');
select throws_like($$select public_external_app_stores(repeat('a',101))$$,'%INVALID_INPUT%','oversized query rejected');
select throws_like($$select public_external_app_stores('',0)$$,'%INVALID_INPUT%','zero page size rejected');
select throws_like($$select public_external_app_stores('',51)$$,'%INVALID_INPUT%','oversized page rejected');
select throws_like($$select public_external_app_stores('',null)$$,'%INVALID_INPUT%','null page size rejected');
select throws_like($$select public_external_app_stores('',25,-1)$$,'%INVALID_INPUT%','negative offset rejected');
select throws_like($$select public_external_app_stores('',25,10001)$$,'%INVALID_INPUT%','unbounded offset rejected');
select throws_like($$select public_external_app_stores('',25,null)$$,'%INVALID_INPUT%','null offset rejected');
select throws_ok($$select * from store_policy_versions$$,'42501',null,'policy records remain private');
select throws_ok($$select * from sellers$$,'42501',null,'seller records remain private');
set local role authenticated;
select is(jsonb_array_length(public_external_app_stores('Synthetic external')->'stores'),2,'authenticated users see the same directory');
select is((select count(*) from jsonb_array_elements(public_app_stores()) where value->>'id' in (:'tenant',:'other')),0::bigint,'ordinary app directory remains unchanged');
select publish_store_policy(:'tenant',gen_random_uuid(),:'enabled',:'body'::jsonb || '{"externalAppSubmissionsEnabled":false,"currency":"NOK"}');
set local role anon;
select is(public_external_app_stores('',25,0,:'tenant')->'stores','[]'::jsonb,'exact refresh respects immediate opt-out');
select is(jsonb_array_length(public_external_app_stores('Synthetic external')->'stores'),1,'old consent cannot keep a disabled store listed');
select * from finish();
rollback;
