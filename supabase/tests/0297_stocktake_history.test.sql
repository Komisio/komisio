begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('29700000-0000-4000-8000-000000000001','owner@count-history.test',now()),
 ('29700000-0000-4000-8000-000000000002','reader@count-history.test',now()),
 ('29700000-0000-4000-8000-000000000003','outsider@count-history.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"29700000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Count history TEST','count-history-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other count TEST','count-history-other',gen_random_uuid())::text,true);
select is(stocktake_session_history(current_setting('test.tenant')::uuid,0)->>'total','0','empty history count');
select is(stocktake_session_history(current_setting('test.tenant')::uuid,0)->'activeId','null'::jsonb,'no active session inferred');
do $$declare session_id uuid; begin
 for n in 1..22 loop
  session_id:=start_stocktake(current_setting('test.tenant')::uuid,gen_random_uuid());
  perform record_stocktake(current_setting('test.tenant')::uuid,gen_random_uuid(),session_id,'closed','',null,0,null,'');
 end loop;
end $$;
select set_config('test.active',start_stocktake(current_setting('test.tenant')::uuid,gen_random_uuid())::text,true);
select start_stocktake(current_setting('test.other')::uuid,gen_random_uuid());
select is(stocktake_session_history(current_setting('test.tenant')::uuid,0)->>'total','23','all own sessions counted');
select is(jsonb_array_length(stocktake_session_history(current_setting('test.tenant')::uuid,0)->'rows'),20,'first page bounded');
select is(jsonb_array_length(stocktake_session_history(current_setting('test.tenant')::uuid,20)->'rows'),3,'older sessions accessible');
select is(stocktake_session_history(current_setting('test.tenant')::uuid,0)->'rows'->0->>'id',current_setting('test.active'),'open session sorts first');
select is(stocktake_session_history(current_setting('test.tenant')::uuid,20)->>'activeId',current_setting('test.active'),'active session retained while browsing history');
select is((select count(distinct r->>'id') from jsonb_array_elements((stocktake_session_history(current_setting('test.tenant')::uuid,0)->'rows') || (stocktake_session_history(current_setting('test.tenant')::uuid,20)->'rows')) r),23::bigint,'stable paging covers every session once');
select is(jsonb_array_length(stocktake_session_history(current_setting('test.tenant')::uuid,200)->'rows'),0,'high page empty');
select is(stocktake_session_history(current_setting('test.tenant')::uuid,200)->>'total','23','high page keeps total');
select throws_like($$select stocktake_session_history(current_setting('test.tenant')::uuid,-1)$$,'%INVALID_INPUT%','negative offset refused');
select throws_like($$select stocktake_session_history(current_setting('test.tenant')::uuid,null)$$,'%INVALID_INPUT%','null offset refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'29700000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"29700000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(stocktake_session_history(current_setting('test.tenant')::uuid,20)->>'total','23','readonly can browse old counts');
select throws_ok($$select stocktake_session_history(current_setting('test.other')::uuid,0)$$,'42501',null,'readonly cannot read another store');
set local "request.jwt.claims"='{"sub":"29700000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select stocktake_session_history(current_setting('test.tenant')::uuid,0)$$,'42501',null,'outsider denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'29700000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"29700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select throws_ok($$select stocktake_session_history(current_setting('test.tenant')::uuid,0)$$,'42501',null,'MFA challenge denied');
reset role;
select ok(not has_function_privilege('anon','public.stocktake_session_history(uuid,integer)','execute'),'anonymous history denied');
select is((select count(*) from stocktake_events where tenant_id=current_setting('test.tenant')::uuid),22::bigint,'history adds no inventory events');
select * from finish();
rollback;
