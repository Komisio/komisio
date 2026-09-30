begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('d1750000-0000-4000-8000-000000000001','ledger-history-owner@example.test',now()),
('d1750000-0000-4000-8000-000000000002','ledger-history-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1750000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Ledger history','ledger-history',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','','123') as seller \gset
select register_seller(:'tenant',gen_random_uuid(),'Other synthetic seller','','456') as other_seller \gset
select set_config('test.tenant',:'tenant',true),set_config('test.seller',:'seller',true),set_config('test.other_seller',:'other_seller',true);
do $$ begin
 for n in 1..51 loop
  perform public.adjust_seller_ledger(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,100,'Synthetic entry '||n);
 end loop;
 for n in 1..55 loop
  perform public.adjust_seller_ledger(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.other_seller')::uuid,200,'Other seller entry '||n);
 end loop;
end $$;
select is(seller_ledger_history_page(:'tenant',:'seller',0)->>'total','51','counts all and only this seller entries');
select is(jsonb_array_length(seller_ledger_history_page(:'tenant',:'seller',0)->'items'),50,'first page is bounded');
select is(jsonb_array_length(seller_ledger_history_page(:'tenant',:'seller',1)->'items'),1,'older entries remain reachable');
select is(seller_ledger_history_page(:'tenant',:'seller',2)->>'page','1','out-of-range page returns the last available page');
select is(seller_ledger_history_page(:'tenant',:'seller',0)->'items',seller_ledger_page(:'tenant',:'seller'),'first-page facts and order match the legacy read');
select ok(not exists(select 1 from jsonb_array_elements(seller_ledger_history_page(:'tenant',:'seller',0)->'items') a join jsonb_array_elements(seller_ledger_history_page(:'tenant',:'seller',1)->'items') b on a->>'id'=b->>'id'),'same-time entries have stable nonoverlapping pages');
select ok(not exists(select 1 from jsonb_array_elements(seller_ledger_history_page(:'tenant',:'seller',0)->'items') x where x->>'reason' like 'Other%'),'other seller entries cannot displace requested history');
select is((select sum((x->>'amount_ore')::bigint)::text from jsonb_array_elements((seller_ledger_history_page(:'tenant',:'seller',0)->'items') || (seller_ledger_history_page(:'tenant',:'seller',1)->'items')) x),'5100','pages retain exact stored amounts');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','5100','reading pages leaves balance unchanged');
select register_seller(:'tenant',gen_random_uuid(),'Empty synthetic seller','','789') as empty_seller \gset
select is(seller_ledger_history_page(:'tenant',:'empty_seller',5)->>'page','0','empty history resets stale paging');
select is(seller_ledger_history_page(:'tenant',:'empty_seller',5)->>'total','0','empty history reports zero');
select throws_like(format('select seller_ledger_history_page(%L,%L,-1)',:'tenant',:'seller'),'%INVALID_INPUT%','negative page refused');
select throws_like(format('select seller_ledger_history_page(%L,%L,1000001)',:'tenant',:'seller'),'%INVALID_INPUT%','unbounded page refused');
select throws_like(format('select seller_ledger_history_page(%L,%L,null)',:'tenant',:'seller'),'%INVALID_INPUT%','null page refused');
select create_tenant('Other ledger store','other-ledger-store',gen_random_uuid()) as other_tenant \gset
select throws_like(format('select seller_ledger_history_page(%L,%L,0)',:'other_tenant',:'seller'),'%SELLER_NOT_FOUND%','seller must belong to the requested store');
reset role;
-- Identity/role fixture; domain facts above still use the identified engine actor.
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','d1750000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1750000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(seller_ledger_history_page(:'tenant',:'seller',1)->>'total','51','readonly member can read older history');
select throws_ok(format('select seller_ledger_history_page(%L,%L,0)',:'other_tenant',:'seller'),'42501',null,'nonmember tenant denied');
set local role anon;
select throws_ok(format('select seller_ledger_history_page(%L,%L,0)',:'tenant',:'seller'),'42501',null,'anonymous caller denied');
select * from finish();
rollback;
