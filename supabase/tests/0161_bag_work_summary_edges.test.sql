begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Edge cases for the handover summary: which draft and reception are "oldest",
-- one bag never sees another bag's or another store's work, every member role
-- reads all three counts, and the bag filter inside reception_queue_facts
-- returns exactly the rows the unfiltered read returns for that bag.
insert into auth.users(id,email,email_confirmed_at) values
('c0000000-0000-4000-8000-000000009911','edges-owner@example.test',now()),
('c0000000-0000-4000-8000-000000009912','edges-staff@example.test',now()),
('c0000000-0000-4000-8000-000000009913','edges-reader@example.test',now()),
('c0000000-0000-4000-8000-000000009914','edges-other-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000009911","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Edges store','edges-store',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','','123')::text,true);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Edges A',null)::text,true);
select set_config('test.bag2',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Edges B',null)::text,true);

-- Two receptions created in the same instant: the lower session id is next; a reception in another bag of the same store never counts here.
select set_config('test.s1','50000000-0000-4000-8000-000000000002',true);
select set_config('test.s2','50000000-0000-4000-8000-000000000001',true);
select set_config('test.s_other','50000000-0000-4000-8000-000000000003',true);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.s_other')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag2')::uuid);
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'receptions','2','only this bag''s receptions count');
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'nextReception',current_setting('test.s2'),'equal created_at breaks the tie by the lower session id');
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag2')::uuid)->>'receptions','1','the other bag counts its own');

-- The bag filter inside reception_queue_facts: same rows and stages as the unfiltered read restricted to the bag.
select is(
 (select array_agg(session_id||':'||stage order by session_id) from reception_queue_facts(current_setting('test.tenant')::uuid,null,null,null,null,current_setting('test.bag')::uuid)),
 (select array_agg(f.session_id||':'||f.stage order by f.session_id) from reception_queue_facts(current_setting('test.tenant')::uuid) f join reception_sessions s on s.id=f.session_id where s.bag_id=current_setting('test.bag')::uuid),
 'bag filter returns exactly the unfiltered rows of that bag with the same stages');
select is((select count(*) from reception_queue_facts(current_setting('test.tenant')::uuid,null,null,null,null,current_setting('test.bag')::uuid)),2::bigint,'two sessions in the bag');
select is((select count(*) from reception_queue_facts(current_setting('test.tenant')::uuid)),3::bigint,'unfiltered read still returns every session in the store');
select is((select count(*) from reception_queue_facts(current_setting('test.tenant')::uuid,'preparing',null,null,1,current_setting('test.bag')::uuid)),1::bigint,'stage, limit and bag filter combine');
select is((select count(*) from reception_queue(current_setting('test.tenant')::uuid)),3::bigint,'the bounded queue caller is unchanged');
select is((select count(*) from reception_queue_facts(current_setting('test.tenant')::uuid,null,null,null,null,gen_random_uuid())),0::bigint,'an unknown bag yields no rows');

-- Every member role reads all three counts.
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000009912','staff'),
 (current_setting('test.tenant')::uuid,'c0000000-0000-4000-8000-000000009913','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000009912","role":"authenticated"}';
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'receptions','2','staff reads receptions');
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000009913","role":"authenticated"}';
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'accepted','0','readonly reads accepted');
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'receptions','2','readonly reads receptions');

-- A real second store with its own bag and work: its member sees only its own and is refused the first store.
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000009914","role":"authenticated"}';
select set_config('test.tenant_b',create_tenant('Edges other store','edges-other-store',gen_random_uuid())::text,true);
select set_config('test.seller_b',register_seller(current_setting('test.tenant_b')::uuid,gen_random_uuid(),'Other seller','','456')::text,true);
select set_config('test.bag_b',receive_bag_with_agreement(current_setting('test.tenant_b')::uuid,gen_random_uuid(),current_setting('test.seller_b')::uuid,'Edges other',null)::text,true);
select is(bag_work_summary(current_setting('test.tenant_b')::uuid,current_setting('test.bag_b')::uuid)->>'receptions','0','and none of the first store''s receptions');
select throws_ok($$select bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)$$,'42501',null,'the second store''s owner is refused the first store');
select throws_like($$select bag_work_summary(current_setting('test.tenant_b')::uuid,current_setting('test.bag')::uuid)$$,'%BAG_NOT_FOUND%','the first store''s bag is not found under the second store');
select throws_ok($$select * from reception_queue_facts(current_setting('test.tenant')::uuid,null,null,null,null,current_setting('test.bag')::uuid)$$,'42501',null,'the bag filter does not open another store''s facts');
set local "request.jwt.claims"='{"sub":"c0000000-0000-4000-8000-000000009911","role":"authenticated"}';
select throws_like($$select bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag_b')::uuid)$$,'%BAG_NOT_FOUND%','the second store''s bag is not found under the first store');
reset role;
select ok(not has_function_privilege('anon','public.reception_queue_facts(uuid,text,timestamptz,uuid,integer,uuid)','execute'),'anonymous facts denied after the signature change');
select is((select count(*) from pg_proc where proname='reception_queue_facts' and pronamespace='public'::regnamespace),1::bigint,'exactly one reception_queue_facts signature');
select * from finish(); rollback;
