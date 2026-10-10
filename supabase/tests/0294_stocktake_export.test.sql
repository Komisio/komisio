begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('d0000000-0000-4000-8000-000000009941','export-owner@example.test',now()),
('d0000000-0000-4000-8000-000000009942','export-reader@example.test',now()),
('d0000000-0000-4000-8000-000000009943','export-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000009941","role":"authenticated"}';
select save_profile('Finding staff','en');
select set_config('test.tenant',create_tenant('Export store','stocktake-export-store',gen_random_uuid())::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeStoreOwned":"store_full"}'::jsonb);
do $$ declare p uuid; i uuid; begin
 for n in 1..55 loop
  p:=gen_random_uuid(); i:=gen_random_uuid();
  perform register_purchase(current_setting('test.tenant')::uuid,p,'Synthetic item '||lpad(n::text,3,'0'),10000,'Synthetic receipt',false);
  perform accept_item(current_setting('test.tenant')::uuid,i,'purchase',p,null,20000);
 end loop;
end $$;
select set_config('test.session',gen_random_uuid()::text,true);
select start_stocktake(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid);
select throws_like($$select stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'all')$$,'%STOCKTAKE_OPEN%','unfinished count is not a completed export');
do $$ declare r record; begin
 for r in select item_id,title from stocktake_expected_items where session_id=current_setting('test.session')::uuid loop
  perform record_stocktake(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'finding','',r.item_id,0,case when r.title='Synthetic item 055' then 'damaged' else 'found' end,'Synthetic checked');
 end loop;
end $$;
select save_profile('Scanning staff','en');
select record_stocktake(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'scan',(select item_id::text from stocktake_expected_items where session_id=current_setting('test.session')::uuid and title='Synthetic item 055'),null,null,null,'');
select is(stocktake_report(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'deviations',0)->'rows'->0->>'reason','Synthetic checked','repeated damage scan preserves finding comment in summary');
select record_stocktake(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'closed','',null,56,null,'');
select set_config('test.export',stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'all')::text,true);
select is(jsonb_array_length(current_setting('test.export')::jsonb->'rows'),55,'exports beyond the screen page without truncation');
select is(current_setting('test.export')::jsonb->'rows'->54->>'title','Synthetic item 055','stable title and ID ordering');
select is(current_setting('test.export')::jsonb->>'id',current_setting('test.session'),'exact selected session');
select ok((current_setting('test.export')::jsonb->>'closedAt') is not null,'closure time included');
select is(current_setting('test.export')::jsonb->>'version','57','closure version included');
select is(current_setting('test.export')::jsonb->'rows'->54->>'reason','Synthetic checked','damage reason retained after rescan');
select is(current_setting('test.export')::jsonb->'rows'->54->>'actor','Finding staff','original finding attribution retained after rescan');
select is((current_setting('test.export')::jsonb->'rows'->54->>'at')::timestamptz,(select created_at from stocktake_events where session_id=current_setting('test.session')::uuid and observation='damaged' and kind='finding'),'finding time retained after rescan');
select is(jsonb_array_length(stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'deviations')->'rows'),1,'discrepancy-only export');
select is(stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'deviations')->'rows'->0->>'observation','damaged','keeps explicit damage finding');
select is((select count(*) from sale_lines where tenant_id=current_setting('test.tenant')::uuid),0::bigint,'no sale created');
select is((select count(*) from stocktake_events where session_id=current_setting('test.session')::uuid),57::bigint,'export adds no findings');
select throws_like($$select stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'unchecked')$$,'%INVALID_INPUT%','export filters bounded');
select throws_like($$select stocktake_export(current_setting('test.tenant')::uuid,gen_random_uuid(),'all')$$,'%STOCKTAKE_NOT_FOUND%','unknown session refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'d0000000-0000-4000-8000-000000009942','readonly');
select ok(not has_function_privilege('anon','public.stocktake_export(uuid,uuid,text)','execute'),'anonymous cannot export');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000009942","role":"authenticated"}';
select lives_ok($$select stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'all')$$,'existing readonly member can export');
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000009943","role":"authenticated"}';
select throws_like($$select stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'all')$$,'%FORBIDDEN%','foreign tenant export denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'d0000000-0000-4000-8000-000000009941','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000009941","role":"authenticated","aal":"aal1"}';
select throws_like($$select stocktake_export(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,'all')$$,'%AUTH_REQUIRED%','MFA required for export');
reset role;
select * from finish();
rollback;
