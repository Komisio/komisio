begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('b0000000-0000-4000-8000-000000009901','bag-owner@example.test',now()),
 ('b0000000-0000-4000-8000-000000009902','bag-reader@example.test',now()),
 ('b0000000-0000-4000-8000-000000009903','bag-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000009901","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Bag reception','bag-reception-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','','123')::text,true);
select set_config('test.other',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Other','','456')::text,true);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Test',null)::text,true);
select set_config('test.bag2',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Test 2',null)::text,true);
select set_config('test.session',gen_random_uuid()::text,true);
select set_config('test.request',gen_random_uuid()::text,true);
select lives_ok($$select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid)$$,'bag session created');
select lives_ok($$select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid)$$,'session retry stable');
select throws_like($$select create_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.other')::uuid,current_setting('test.bag')::uuid)$$,'%INVALID_INPUT%','cannot change bag seller');
select throws_like($$select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag2')::uuid)$$,'%REQUEST_CONFLICT%','cannot move session to another bag');
select throws_like($$select quick_receive_from_bag(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Lamp"}',15000,current_setting('test.bag2')::uuid)$$,'%INVALID_INPUT%','receipt requires exact bag');
select set_config('test.result',quick_receive_from_bag(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Lamp"}',15000,current_setting('test.bag')::uuid)::text,true);
select is(quick_receive_from_bag(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Lamp"}',15000,current_setting('test.bag')::uuid),current_setting('test.result')::jsonb,'receipt retry does not duplicate item');
select is(jsonb_array_length(bag_received_items(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)),1,'bag lists one accepted item');
select is(bag_received_items(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->0->>'title','Lamp','list uses actual item description');
select is(bag_received_items(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->0->>'price_ore','15000','list uses actual price');
select is(jsonb_array_length(bag_received_items(current_setting('test.tenant')::uuid,current_setting('test.bag2')::uuid)),0,'other bag excludes this item');
reset role;
select throws_like($$update reception_sessions set bag_id=current_setting('test.bag2')::uuid where id=current_setting('test.session')::uuid$$,'%IMMUTABLE_RECEPTION%','bag provenance immutable');
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'b0000000-0000-4000-8000-000000009902','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000009902","role":"authenticated"}';
select is(jsonb_array_length(bag_received_items(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)),1,'readonly can read');
select throws_like($$select create_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.bag')::uuid)$$,'%FORBIDDEN%','readonly cannot create');
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000009903","role":"authenticated"}';
select throws_like($$select bag_received_items(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)$$,'%FORBIDDEN%','outsider cannot read bag');
select throws_like($$select create_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.bag')::uuid)$$,'%FORBIDDEN%','outsider cannot write');
select * from finish();
rollback;
