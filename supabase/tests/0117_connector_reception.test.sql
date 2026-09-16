begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000971','reception-connector-owner@example.test',now());
create function pg_temp.h(s text) returns text language sql immutable as $$ select encode(sha256(convert_to(s,'UTF8')),'hex') $$;
set local role anon;
select register_connector_client('c0000000-0000-4000-8000-000000000011','Claude','{https://claude.ai/api/mcp/auth_callback}');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000971","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Reception connector store','reception-connector-test',gen_random_uuid())::text,true);
-- A grant with exactly the two scopes the two tools ask for, and nothing else.
select authorize_connector('a0000000-0000-4000-8000-000000000011',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000011','https://claude.ai/api/mcp/auth_callback','{reception:read,lifecycle:propose}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-11'),'aal1');
set local role anon;
select exchange_connector_code(pg_temp.h('code-11'),'c0000000-0000-4000-8000-000000000011','https://claude.ai/api/mcp/auth_callback','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('access-11'),pg_temp.h('refresh-11'));
-- The reception list is reachable under reception:read and is a list, empty
-- in a store that has received nothing.
select is(connector_call(pg_temp.h('access-11'),'reception_queue',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_stage',null,'p_before',null,'p_before_id',null)),'[]'::jsonb,'the reception queue is reachable under reception:read');
-- A price proposal reads the item first; the read must not need a second scope.
select is(connector_call(pg_temp.h('access-11'),'item_detail',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_item',gen_random_uuid())),null::jsonb,'an item read is reachable under lifecycle:propose');
select lives_ok($$select connector_call(pg_temp.h('access-11'),'price_evidence',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_category',null,'p_query',null,'p_days',90))$$,'and so is the evidence the proposal must cite');
-- Neither row widens the grant: a store read is still outside these scopes.
select throws_like($$select connector_call(pg_temp.h('access-11'),'current_store_profile',jsonb_build_object('p_tenant',current_setting('test.tenant')))$$,'%SCOPE_REQUIRED%','a function outside the two scopes is still refused');
-- And a grant without them cannot reach either function.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000971","role":"authenticated"}';
select authorize_connector('a0000000-0000-4000-8000-000000000012',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000011','https://claude.ai/api/mcp/auth_callback','{economy:read}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-12'),'aal1');
set local role anon;
select exchange_connector_code(pg_temp.h('code-12'),'c0000000-0000-4000-8000-000000000011','https://claude.ai/api/mcp/auth_callback','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('access-12'),pg_temp.h('refresh-12'));
select throws_like($$select connector_call(pg_temp.h('access-12'),'reception_queue',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_stage',null,'p_before',null,'p_before_id',null))$$,'%SCOPE_REQUIRED%','an economy grant cannot list receptions');
select throws_like($$select connector_call(pg_temp.h('access-12'),'item_detail',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_item',gen_random_uuid()))$$,'%SCOPE_REQUIRED%','and cannot read an item');
-- The registration rows are exactly the two this migration adds.
reset role;
select is((select count(*) from connector_functions where function_name='reception_queue'),1::bigint,'the reception queue is registered once');
select is((select scope from connector_functions where function_name='reception_queue'),'reception:read','under the reception read scope');
select is((select count(*) from connector_functions where function_name='item_detail'),2::bigint,'an item read is registered under two scopes');
select * from finish();
rollback;
