begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001581','handover-page@example.test',now()),
 ('f0000000-0000-4000-8000-000000001582','handover-outsider@example.test',now()),
 ('f0000000-0000-4000-8000-000000001583','handover-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000001584','handover-readonly@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001581","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Handover page test','handover-page-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic Anna','handover-page@example.test','')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"custodySources":["staff_receipt","seller_dropoff"]}'::jsonb);
select set_config('test.old',gen_random_uuid()::text,true);
select create_my_handover(current_setting('test.tenant')::uuid,current_setting('test.old')::uuid,current_setting('test.seller')::uuid,'box',2,'Synthetic older open');
do $$ declare n integer; h uuid; begin for n in 1..102 loop
 h:=gen_random_uuid();
 perform public.create_my_handover(current_setting('test.tenant')::uuid,h,current_setting('test.seller')::uuid,'bag',1,'Synthetic newer cancelled');
 perform public.cancel_my_handover(current_setting('test.tenant')::uuid,gen_random_uuid(),h);
end loop; end $$;
select set_config('test.page',handover_queue_page(current_setting('test.tenant')::uuid)::text,true);
select is((current_setting('test.page')::jsonb->>'total')::int,103,'total includes every status beyond legacy100');
select is(jsonb_array_length(current_setting('test.page')::jsonb->'handovers'),25,'bounded first page');
select is(current_setting('test.page')::jsonb->'handovers'->0->>'id',current_setting('test.old'),'open comes before all cancelled records');
select is((handover_queue_page(current_setting('test.tenant')::uuid,'','open')->>'total')::int,1,'open status count');
select is((handover_queue_page(current_setting('test.tenant')::uuid,'','cancelled')->>'total')::int,102,'cancelled status count');
select is((handover_queue_page(current_setting('test.tenant')::uuid,'','received')->>'total')::int,0,'empty received status count');
select is((handover_queue_page(current_setting('test.tenant')::uuid,' sYNThetic anNA ')->>'total')::int,103,'trimmed case-insensitive seller search');
select is((handover_queue_page(current_setting('test.tenant')::uuid,'%')->>'total')::int,0,'percent is literal');
select is((handover_queue_page(current_setting('test.tenant')::uuid,'_')->>'total')::int,0,'underscore is literal');
select is(jsonb_array_length(handover_queue_page(current_setting('test.tenant')::uuid,'','all',100)->'handovers'),3,'last page beyond100');
select is(jsonb_array_length(handover_queue_page(current_setting('test.tenant')::uuid,'','all',125)->'handovers'),0,'past-end is empty');
select is((handover_queue_page(current_setting('test.tenant')::uuid,'','all',125)->>'total')::int,103,'past-end retains complete total');
select is((select count(distinct h->>'id')::int from generate_series(0,4) p cross join lateral jsonb_array_elements(handover_queue_page(current_setting('test.tenant')::uuid,'','all',p*25)->'handovers') h),103,'stable pages neither skip nor duplicate ties');
select is((handover_queue_page(current_setting('test.tenant')::uuid,(select 'H-'||reference from seller_handovers where id=current_setting('test.old')::uuid),'open')->'handovers'->0->>'id'),current_setting('test.old'),'reference search finds older open record');
select throws_ok(format('select handover_queue_page(%L,%L,%L,-1)',current_setting('test.tenant'),'','all'),'P0001','INVALID_INPUT','negative offset denied');
select throws_ok(format('select handover_queue_page(%L,%L)',current_setting('test.tenant'),repeat('x',121)),'P0001','INVALID_INPUT','oversized query denied');
select throws_ok(format('select handover_queue_page(%L,%L,%L)',current_setting('test.tenant'),'','invalid'),'P0001','INVALID_INPUT','unknown status denied');
select throws_ok(format('select handover_queue_page(%L)',gen_random_uuid()),'42501','FORBIDDEN','another tenant denied');
-- Every member role reads the same complete queue; a staff and a readonly member are added as the database owner, as other suites do.
reset role;
insert into public.tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000001583','staff'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000001584','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001583","role":"authenticated"}';
select is((handover_queue_page(current_setting('test.tenant')::uuid)->>'total')::int,103,'staff reads the complete total');
select is(handover_queue_page(current_setting('test.tenant')::uuid)->'handovers'->0->>'id',current_setting('test.old'),'staff sees the older open record first');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001584","role":"authenticated"}';
select is((handover_queue_page(current_setting('test.tenant')::uuid,'','open')->>'total')::int,1,'readonly reads the open count');
select is(jsonb_array_length(handover_queue_page(current_setting('test.tenant')::uuid,'','all',100)->'handovers'),3,'readonly pages to the end');
-- A real second store with its own announcement: neither store's read leaks into the other.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001582","role":"authenticated"}';
select throws_ok(format('select handover_queue_page(%L)',current_setting('test.tenant')),'42501','FORBIDDEN','non-member denied');
select set_config('test.tenant_b',create_tenant('Handover page other store','handover-page-other',gen_random_uuid())::text,true);
select set_config('test.seller_b',register_seller(current_setting('test.tenant_b')::uuid,gen_random_uuid(),'Synthetic Bo','handover-outsider@example.test','')::text,true);
select publish_store_policy(current_setting('test.tenant_b')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant_b')::uuid)->'policy') || '{"custodySources":["staff_receipt","seller_dropoff"]}'::jsonb);
select set_config('test.other_open',gen_random_uuid()::text,true);
select create_my_handover(current_setting('test.tenant_b')::uuid,current_setting('test.other_open')::uuid,current_setting('test.seller_b')::uuid,'bag',1,'Synthetic other store open');
select is((handover_queue_page(current_setting('test.tenant_b')::uuid)->>'total')::int,1,'the second store counts only its own announcement');
select is(handover_queue_page(current_setting('test.tenant_b')::uuid)->'handovers'->0->>'sellerId',current_setting('test.seller_b'),'and lists only its own seller');
select throws_ok(format('select handover_queue_page(%L)',current_setting('test.tenant')),'42501','FORBIDDEN','the second store''s owner cannot read the first store');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001581","role":"authenticated"}';
select is((handover_queue_page(current_setting('test.tenant')::uuid)->>'total')::int,103,'the first store''s total is unchanged by the second store');
select is((select count(*)::int from generate_series(0,4) p cross join lateral jsonb_array_elements(handover_queue_page(current_setting('test.tenant')::uuid,'','all',p*25)->'handovers') h where h->>'sellerId' is distinct from current_setting('test.seller')),0,'every page of the first store belongs to its own seller');
select throws_ok(format('select handover_queue_page(%L)',current_setting('test.tenant_b')),'42501','FORBIDDEN','the first store''s owner cannot read the second store');
reset role;
select ok(not has_function_privilege('anon','public.handover_queue_page(uuid,text,text,integer)','EXECUTE'),'anonymous read denied');
select is((select prosecdef from pg_proc where oid='public.handover_queue_page(uuid,text,text,integer)'::regprocedure),false,'read remains security invoker and RLS bound');
select * from finish();
rollback;
