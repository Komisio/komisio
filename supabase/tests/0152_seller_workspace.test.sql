begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('f2520000-0000-4000-8000-000000000001','workspace-owner@example.test',now()),
('f2520000-0000-4000-8000-000000000002','workspace-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2520000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Seller workspace','seller-workspace-test',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Seller one','','123') as seller \gset
select register_seller(:'tenant',gen_random_uuid(),'Seller two','','456') as second \gset
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','',null) as bag \gset
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'second','',null) as otherbag \gset
select set_config('test.tenant',:'tenant',true),set_config('test.bag',:'bag',true),set_config('test.otherbag',:'otherbag',true);
do $$ declare d uuid; begin
 for n in 1..27 loop
 d:=gen_random_uuid();
 perform public.save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,d,0,'Seller one item '||n,'Chair','');
 perform public.accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',d,1,12000);
 end loop;
 for n in 1..55 loop
 d:=gen_random_uuid();
 perform public.save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.otherbag')::uuid,d,0,'Seller two item '||n,'Table','');
 perform public.accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',d,1,15000);
 end loop;
end $$;
select is(seller_workspace_items(:'tenant',:'seller')->>'total','27','counts only this seller beyond page limit');
select is(jsonb_array_length(seller_workspace_items(:'tenant',:'seller')->'items'),25,'first page bounded');
select is(jsonb_array_length(seller_workspace_items(:'tenant',:'seller',1)->'items'),2,'second page reaches older seller items');
select is(jsonb_array_length(seller_workspace_items(:'tenant',:'seller',2)->'items'),0,'out of range is empty');
select ok(not exists(select 1 from jsonb_array_elements(seller_workspace_items(:'tenant',:'seller')->'items') a join jsonb_array_elements(seller_workspace_items(:'tenant',:'seller',1)->'items') b on a->>'id'=b->>'id'),'stable same-time pagination has no overlap');
select ok(not exists(select 1 from jsonb_array_elements(seller_workspace_items(:'tenant',:'seller')->'items') x where x->>'title' not like 'Seller one item%'),'another seller cannot displace target items');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'stage','on_sale','existing lifecycle stage');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'priceOre','12000','exact current price');
select throws_like(format('select seller_workspace_items(%L,%L,-1)',:'tenant',:'seller'),'%INVALID_INPUT%','negative page rejected');
select create_tenant('Other workspace','other-workspace-test',gen_random_uuid()) as other \gset
select throws_like(format('select seller_workspace_items(%L,%L)',:'other',:'seller'),'%SELLER_NOT_FOUND%','seller bound to store even when caller owns both');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f2520000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f2520000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(seller_workspace_items(:'tenant',:'seller')->>'total','27','readonly member may inspect seller');
select throws_ok(format('select seller_workspace_items(%L,%L)',:'other',:'seller'),'42501',null,'unrelated tenant denied');
set local role anon;
select throws_ok(format('select seller_workspace_items(%L,%L)',:'tenant',:'seller'),'42501',null,'anonymous access denied');
select * from finish();
rollback;
