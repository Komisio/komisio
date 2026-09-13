begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Structural gates: every public table has row level security, only the
-- known engine-only table has no policy, anonymous callers can execute only
-- the listed functions, and anonymous sessions have no table privileges.
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),0::bigint,'every public table has row level security');
select is((select coalesce(array_agg(c.relname::text order by c.relname),'{}') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists(select 1 from pg_policy where polrelid=c.oid)),array['statement_counters'],'only the engine-only counter table has no policy');
select is((select coalesce(array_agg(p.proname::text order by p.proname),'{}') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon',p.oid,'execute') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
 array['public_store_profile','reception_photo_access','seller_reception_photo_access'],'anonymous callers execute only the public profile read and the storage access hooks');
select is((select count(*) from information_schema.role_table_grants where grantee in ('anon','PUBLIC') and table_schema='public'),0::bigint,'no table privileges for anon or public');
select is((select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and privilege_type<>'SELECT'),0::bigint,'authenticated has no direct write privilege on any table');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not coalesce(array_to_string(c.reloptions,',') like '%security_invoker=true%',false)),0::bigint,'every view runs as the invoker');
-- Helpers for the dynamic sweep, created by the superuser before switching role.
-- A table the role may not read at all counts as zero visible rows.
create function pg_temp.tenant_rows(p_table text,p_tenant uuid) returns bigint language plpgsql as $$
declare n bigint; begin execute format('select count(*) from public.%I where tenant_id=$1',p_table) into n using p_tenant; return n;
-- The planner may call this before the tenant_id filter; a table without the column counts as zero.
exception when insufficient_privilege or undefined_column then return 0; end $$;
create function pg_temp.all_rows(p_table text) returns bigint language plpgsql as $$
declare n bigint; begin execute format('select count(*) from public.%I',p_table) into n; return n;
exception when insufficient_privilege then return 0; end $$;
-- Tenant A with rows in as many tables as the fixtures reach.
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000341','isolation-a@example.test',now()),
 ('f0000000-0000-4000-8000-000000000342','isolation-b@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000341","role":"authenticated"}';
select set_config('test.a',create_tenant('Isolation A','isolation-a',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller A','a@isolation.test','')::text,true);
select publish_seller_terms(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,'inclusive',55,'');
select set_config('test.agreement',publish_seller_agreement(current_setting('test.a')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.a')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.a')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.a')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,50000);
select record_sale(current_setting('test.a')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',50000)));
select set_config('test.payout',gen_random_uuid()::text,true);
select request_payout(current_setting('test.a')::uuid,current_setting('test.payout')::uuid,current_setting('test.seller')::uuid,10000);
select approve_payout(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.payout')::uuid,'');
select issue_statement(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'2026-09-01T00:00:00Z','2026-09-12T00:00:00Z',null);
select generate_day_close(current_setting('test.a')::uuid,gen_random_uuid(),'2026-09-10');
select publish_accounting_map(current_setting('test.a')::uuid,gen_random_uuid(),null,'{"grossOre":{"account":"1930","side":"debit"}}');
select set_config('test.profile',publish_store_profile(current_setting('test.a')::uuid,gen_random_uuid(),null,'{"address":{"street":"","postalCode":"","city":"Stockholm"},"contact":{"email":"","phone":"","website":""},"openingHours":[],"accepts":"","concept":"Isolation","language":"sv"}')::text,true);
select create_reception_session(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid);
select queue_seller_communication(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null);
select register_printer(current_setting('test.a')::uuid,gen_random_uuid(),'Counter','tcp','192.0.2.10:9100','ZD421',203);
select propose_operation(current_setting('test.a')::uuid,gen_random_uuid(),'updateStoreProfile',jsonb_build_object('expectedCurrentId',current_setting('test.profile'),'profile','{"address":{"street":"","postalCode":"","city":"Stockholm"},"contact":{"email":"","phone":"","website":""},"openingHours":[],"accepts":"","concept":"Proposed","language":"sv"}'::jsonb),'agent',now()+interval '1 day');
-- Coverage: how many tenant-scoped tables hold at least one row of A now.
reset role;
select set_config('test.covered',(select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped) and pg_temp.tenant_rows(c.relname,current_setting('test.a')::uuid)>0),true);
select cmp_ok(current_setting('test.covered')::int,'>=',28,'the fixture reaches at least 28 tenant-scoped tables ('||current_setting('test.covered')||')');
-- Tenant B's owner sees nothing of A in any tenant-scoped table.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000342","role":"authenticated"}';
select set_config('test.b',create_tenant('Isolation B','isolation-b',gen_random_uuid())::text,true);
select is(pg_temp.tenant_rows(c.relname,current_setting('test.a')::uuid),0::bigint,'tenant B sees no rows of A in '||c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped)
 order by c.relname;
select throws_ok($$select seller_balance(current_setting('test.a')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'B cannot read a seller balance of A');
select throws_ok($$select current_store_profile(current_setting('test.a')::uuid)$$,'42501',null,'B cannot read the member profile view of A');
select throws_ok($$select economy_summary(current_setting('test.a')::uuid,'2026-09-01','2026-09-30')$$,'42501',null,'B cannot read the economy of A');
select throws_ok($$select settlement_candidates(current_setting('test.a')::uuid)$$,'42501',null,'B cannot list settlement candidates of A');
select throws_ok($$select * from operation_queue_filtered_page(current_setting('test.a')::uuid,'all',null,null,null)$$,'42501',null,'B cannot read the operations queue of A');
-- Anonymous sessions see no row of any table at all.
set local role anon;
select is(pg_temp.all_rows(c.relname),0::bigint,'anon sees no rows in '||c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname not in ('tenants','user_profiles')
 order by c.relname;
select throws_ok($$select usage_summary(current_setting('test.a')::uuid,null)$$,'42501',null,'anon cannot execute the usage read');
select is(public_store_profile('isolation-a')->'profile'->>'concept','Isolation','anon reads only the published profile of A');
select * from finish();
rollback;
