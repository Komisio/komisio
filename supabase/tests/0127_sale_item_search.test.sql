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
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
select set_config('test.result',quick_receive_from_bag(current_setting('test.tenant')::uuid,current_setting('test.request')::uuid,current_setting('test.session')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Search lamp"}',15000,current_setting('test.bag')::uuid)::text,true);
select is(jsonb_array_length(sale_item_search(current_setting('test.tenant')::uuid,'LAMP')),1,'case insensitive title');
select is(jsonb_array_length(sale_item_search(current_setting('test.tenant')::uuid,'I-'||upper(left(current_setting('test.result')::jsonb->>'itemId',8)))),1,'printed reference');
select is(jsonb_array_length(sale_item_search(current_setting('test.tenant')::uuid,current_setting('test.result')::jsonb->>'itemId')),1,'full id');
select is(jsonb_array_length(sale_item_search(current_setting('test.tenant')::uuid,'%_')),0,'literal wildcards');
select is(jsonb_array_length(sale_item_search(current_setting('test.tenant')::uuid,'')),0,'no empty inventory dump');
select is(sale_item_search(current_setting('test.tenant')::uuid,'lamp')->0->>'priceOre','15000','price in exact ore');
reset role;
insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(current_setting('test.tenant')::uuid,(current_setting('test.result')::jsonb->>'itemId')::uuid,'period_ended','{}','b0000000-0000-4000-8000-000000009901');
select is(jsonb_array_length(sale_item_search(current_setting('test.tenant')::uuid,'lamp')),0,'ended stock excluded');
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'b0000000-0000-4000-8000-000000009902','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000009902","role":"authenticated"}';
select throws_like($$select sale_item_search(current_setting('test.tenant')::uuid,'lamp')$$,'%FORBIDDEN%','read only cannot use sales lookup');
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000009903","role":"authenticated"}';
select throws_like($$select sale_item_search(current_setting('test.tenant')::uuid,'lamp')$$,'%FORBIDDEN%','outsider denied');
select * from finish(); rollback;
