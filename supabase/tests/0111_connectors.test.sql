begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000951','connector-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000952','connector-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000953','connector-outsider@example.test',now());
-- Hashes stand in for tokens the application generated; SQL only ever sees hashes.
create function pg_temp.h(s text) returns text language sql immutable as $$ select encode(sha256(convert_to(s,'UTF8')),'hex') $$;
-- An assistant registers itself without a session.
set local role anon;
select is(register_connector_client('c0000000-0000-4000-8000-000000000001','Claude','{https://claude.ai/api/mcp/auth_callback}')->>'name','Claude','a public client registers');
select lives_ok($$select register_connector_client('c0000000-0000-4000-8000-000000000001','Claude','{https://claude.ai/api/mcp/auth_callback}')$$,'the same registration repeats');
select throws_like($$select register_connector_client('c0000000-0000-4000-8000-000000000001','Other','{https://claude.ai/api/mcp/auth_callback}')$$,'%REQUEST_CONFLICT%','a different registration under the same id is refused');
select throws_like($$select register_connector_client(gen_random_uuid(),'Evil','{http://evil.example/cb}')$$,'%INVALID_INPUT%','plain http outside localhost is refused');
select throws_ok($$select count(*) from connector_clients$$,'42501',null,'clients are not readable directly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000951","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Connector store','connector-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other store','connector-other',gen_random_uuid())::text,true);
select create_invitation(current_setting('test.tenant')::uuid,'connector-staff@example.test','staff',repeat('c',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000952","role":"authenticated"}';
select accept_invitation(repeat('c',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000951","role":"authenticated"}';
-- Consent: the owner approves Claude for the store with two scopes.
select throws_like($$select authorize_connector('a0000000-0000-4000-8000-000000000001',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000001','https://elsewhere.example/cb','{items:read}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-1'),'aal1')$$,'%INVALID_INPUT%','an unregistered redirect is refused');
select throws_like($$select authorize_connector('a0000000-0000-4000-8000-000000000001',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','{reception:photos}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-1'),'aal1')$$,'%INVALID_INPUT%','photos are not a hosted scope');
select is(authorize_connector('a0000000-0000-4000-8000-000000000001',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','{items:read,economy:read}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-1'),'aal1')->>'clientName','Claude','the owner approves the client');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='connector.authorized'),1::bigint,'the approval is audited');
-- The token endpoint runs without a session.
set local role anon;
select throws_like($$select exchange_connector_code(pg_temp.h('code-1'),'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','wrong-challenge-wrong-challenge-wrong-challenge',pg_temp.h('access-1'),pg_temp.h('refresh-1'))$$,'%CONNECTOR_CODE_INVALID%','a wrong PKCE challenge is refused');
select is(exchange_connector_code(pg_temp.h('code-1'),'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('access-1'),pg_temp.h('refresh-1'))->>'tenantId',current_setting('test.tenant'),'the code becomes tokens for the store');
select throws_like($$select exchange_connector_code(pg_temp.h('code-1'),'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('access-x'),pg_temp.h('refresh-x'))$$,'%CONNECTOR_CODE_REUSED%','a code is one-time');
select void_connector_secret(pg_temp.h('code-1'));
select throws_like($$select connector_token_info(pg_temp.h('access-1'))$$,'%CONNECTOR_REVOKED%','and the replay voided the grant');
-- A fresh grant for the calls.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000951","role":"authenticated"}';
select authorize_connector('a0000000-0000-4000-8000-000000000002',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','{items:read,economy:read,items:propose}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-2'),'aal1');
set local role anon;
select exchange_connector_code(pg_temp.h('code-2'),'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('access-2'),pg_temp.h('refresh-2'));
select is(connector_token_info(pg_temp.h('access-2'))->>'userId','f0000000-0000-4000-8000-000000000951','the token names the person who approved');
select is(connector_call(pg_temp.h('access-2'),'tenant_role',jsonb_build_object('p_tenant',current_setting('test.tenant'))),'"owner"'::jsonb,'a call runs as that person');
select is(jsonb_typeof(connector_call(pg_temp.h('access-2'),'items_overview',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_query','','p_stage',null,'p_limit',10))),'object','an items read under items:read works');
select throws_like($$select connector_call(pg_temp.h('access-2'),'economy_summary',jsonb_build_object('p_tenant',current_setting('test.other'),'p_from','2026-09-01','p_to','2026-09-30'))$$,'%FORBIDDEN%','another store is refused even for a member');
select throws_like($$select connector_call(pg_temp.h('access-2'),'current_store_profile',jsonb_build_object('p_tenant',current_setting('test.tenant')))$$,'%SCOPE_REQUIRED%','a function outside the scopes is refused');
select throws_like($$select connector_call(pg_temp.h('access-2'),'accept_item',jsonb_build_object('p_tenant',current_setting('test.tenant')))$$,'%SCOPE_REQUIRED%','an engine write is not callable at all');
select throws_like($$select connector_call(pg_temp.h('access-2'),'propose_operation',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_id',gen_random_uuid(),'p_kind','approvePayout','p_payload','{}'::jsonb,'p_actor_label','Claude','p_expires',now()+interval '1 day'))$$,'%SCOPE_REQUIRED%','a proposal kind outside the scopes is refused');
select throws_like($$select connector_call(pg_temp.h('access-2'),'items_overview',jsonb_build_object('p_tenant',current_setting('test.tenant'),'p_bogus',1))$$,'%INVALID_INPUT%','unknown arguments are refused');
select throws_like($$select connector_call(pg_temp.h('access-9'),'tenant_role',jsonb_build_object('p_tenant',current_setting('test.tenant')))$$,'%CONNECTOR_TOKEN_INVALID%','an unknown token is refused');
reset role;
select is((select count(*) from connector_calls where grant_id='a0000000-0000-4000-8000-000000000002'),2::bigint,'successful calls are logged');
set local role anon;
-- Refresh rotates; reuse revokes.
select is(refresh_connector_token(pg_temp.h('refresh-2'),'c0000000-0000-4000-8000-000000000001',pg_temp.h('access-3'),pg_temp.h('refresh-3'))->>'tenantId',current_setting('test.tenant'),'a refresh token rotates');
select is(connector_call(pg_temp.h('access-3'),'tenant_role',jsonb_build_object('p_tenant',current_setting('test.tenant'))),'"owner"'::jsonb,'the new access token works');
select throws_like($$select refresh_connector_token(pg_temp.h('refresh-2'),'c0000000-0000-4000-8000-000000000001',pg_temp.h('access-4'),pg_temp.h('refresh-4'))$$,'%CONNECTOR_TOKEN_REUSED%','reusing the old refresh token is detected');
select void_connector_secret(pg_temp.h('refresh-2'));
select throws_like($$select connector_call(pg_temp.h('access-3'),'tenant_role',jsonb_build_object('p_tenant',current_setting('test.tenant')))$$,'%CONNECTOR_REVOKED%','and its access token stops');
-- Listing and revoking in the app; staff see only their own.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000952","role":"authenticated"}';
select is(connectors(current_setting('test.tenant')::uuid),'[]'::jsonb,'staff see no connector of the owner');
select authorize_connector('a0000000-0000-4000-8000-000000000003',current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000000001','https://claude.ai/api/mcp/auth_callback','{economy:read}','E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',pg_temp.h('code-3'),'aal1');
select is(jsonb_array_length(connectors(current_setting('test.tenant')::uuid)),1,'staff see their own');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000951","role":"authenticated"}';
select is(jsonb_array_length(connectors(current_setting('test.tenant')::uuid)),1,'the owner sees every active connector');
select is((revoke_connector(current_setting('test.tenant')::uuid,'a0000000-0000-4000-8000-000000000003')->>'revokedAt') is not null,true,'the owner disconnects it');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000953","role":"authenticated"}';
select throws_ok($$select connectors(current_setting('test.tenant')::uuid)$$,'42501',null,'an outsider sees nothing');
-- Every listed function exists and takes the store as p_tenant.
reset role;
select is((select count(*) from (select distinct f.function_name from connector_functions f) x where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=x.function_name and 'p_tenant'=any(p.proargnames))),0::bigint,'every allowed function exists with a p_tenant parameter');
select * from finish();
rollback;
