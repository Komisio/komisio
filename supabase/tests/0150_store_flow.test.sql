begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('f2500000-0000-4000-8000-000000000001','flow-owner@example.test',now()),
('f2500000-0000-4000-8000-000000000002','flow-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2500000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Flow test','flow-synthetic',gen_random_uuid()) as tenant \gset
select is(read_store_flow(:'tenant')->>'revision','0','new store starts without instructions');
select is(save_store_flow(:'tenant',0,'{"receive":"Shelf B"}')->>'revision','1','owner saves revision');
select is(read_store_flow(:'tenant')->'notes'->>'receive','Shelf B','notes persist');
select throws_like(format('select save_store_flow(%L,0,%L)',:'tenant','{}'),'%STALE_VERSION%','stale editor cannot overwrite');
select throws_like(format('select save_store_flow(%L,1,%L)',:'tenant','{"unknown":"bad"}'),'%INVALID_INPUT%','unknown steps rejected');
select throws_like(format('select save_store_flow(%L,1,%L)',:'tenant','{"receive":null}'),'%INVALID_INPUT%','non-text instructions rejected');
select throws_like(format('select save_store_flow(%L,1,%L)',:'tenant',jsonb_build_object('receive',repeat('x',2001))::text),'%INVALID_INPUT%','length bounded');
select throws_ok(format('update tenants set flow_notes=%L where id=%L','{}',:'tenant'),'42501',null,'direct mutation denied');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f2500000-0000-4000-8000-000000000002','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2500000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(read_store_flow(:'tenant')->'notes'->>'receive','Shelf B','staff reads shared instructions');
select throws_like(format('select save_store_flow(%L,1,%L)',:'tenant','{}'),'%FORBIDDEN%','staff cannot edit');
select throws_like($$select read_store_flow('f2500000-0000-4000-8000-000000000099')$$,'%FORBIDDEN%','unrelated store denied');
reset role;
update tenant_members set role='admin' where tenant_id=:'tenant' and user_id='f2500000-0000-4000-8000-000000000002';
set local role authenticated;
select is(save_store_flow(:'tenant',1,'{}')->>'revision','2','admin can clear instructions');
reset role;
update tenant_members set role='readonly' where tenant_id=:'tenant' and user_id='f2500000-0000-4000-8000-000000000002';
set local role authenticated;
select is(read_store_flow(:'tenant')->>'revision','2','readonly member can read');
select throws_like(format('select save_store_flow(%L,2,%L)',:'tenant','{}'),'%FORBIDDEN%','readonly member cannot edit');
set local role anon;
select throws_ok(format('select read_store_flow(%L)',:'tenant'),'42501',null,'anonymous access denied');
select * from finish();
rollback;
