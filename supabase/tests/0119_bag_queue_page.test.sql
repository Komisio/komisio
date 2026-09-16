begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000991','bag-queue-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000992','bag-queue-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000991","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Bag queue','bag-queue-test',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other bags','bag-queue-other',gen_random_uuid())::text,true);
select set_config('test.a',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller A','','1')::text,true);
select set_config('test.b',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller B','','2')::text,true);
select set_config('test.othersel',register_seller(current_setting('test.other')::uuid,gen_random_uuid(),'Other seller','','3')::text,true);
-- Three bags for A and one for B, plus one in another store that must never show.
select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.a')::uuid,'first');
select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.a')::uuid,'second');
select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.b')::uuid,'third');
select receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.a')::uuid,'fourth');
select receive_bag(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.othersel')::uuid,'elsewhere');
select set_config('test.refs',(select jsonb_agg(reference order by reference) from bag_receipts where tenant_id=current_setting('test.tenant')::uuid)::text,true);

-- Newest first, this store only, with the seller name the queue shows.
select is(jsonb_array_length(bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,null)),4,'the store''s four bags are listed');
select is(bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,null)->0->>'note','fourth','newest first');
select is(bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,null)->3->>'note','first','oldest last');
select is(bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,null)->0->'sellers'->>'name','Seller A','the seller name is embedded');
-- The filters the intake page offers.
select is(jsonb_array_length(bag_queue_page(current_setting('test.tenant')::uuid,current_setting('test.b')::uuid,null,null,null)),1,'one seller''s bags only');
select is(bag_queue_page(current_setting('test.tenant')::uuid,current_setting('test.b')::uuid,null,null,null)->0->>'note','third','and it is that seller''s bag');
select is(jsonb_array_length(bag_queue_page(current_setting('test.tenant')::uuid,null,(current_setting('test.refs')::jsonb->>0)::bigint,null,null)),1,'one bag by its reference');
select is(bag_queue_page(current_setting('test.tenant')::uuid,null,(current_setting('test.refs')::jsonb->>0)::bigint,null,null)->0->>'note','first','the reference picks that bag');
-- Cursors: older walks back newest first, newer walks forward oldest first.
select is(jsonb_array_length(bag_queue_page(current_setting('test.tenant')::uuid,null,null,(current_setting('test.refs')::jsonb->>2)::bigint,null)),2,'older than the third is two bags');
select is(bag_queue_page(current_setting('test.tenant')::uuid,null,null,(current_setting('test.refs')::jsonb->>2)::bigint,null)->0->>'note','second','and the newest of them comes first');
select is(bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,(current_setting('test.refs')::jsonb->>1)::bigint)->0->>'note','third','newer than the second starts at the oldest of them');
select throws_like($$select bag_queue_page(current_setting('test.tenant')::uuid,null,null,1,2)$$,'%INVALID_INPUT%','both cursors at once is refused');
-- Nothing of another store leaks, and an empty answer is a list.
select is((select count(*) from jsonb_array_elements(bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,null)) e where e->>'note'='elsewhere'),0::bigint,'another store''s bag never appears');
select is(bag_queue_page(current_setting('test.tenant')::uuid,current_setting('test.othersel')::uuid,null,null,null),'[]'::jsonb,'a seller of another store lists nothing');

-- The read belongs to a member of that store, and the connector can reach it.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000992","role":"authenticated"}';
select throws_ok($$select bag_queue_page(current_setting('test.tenant')::uuid,null,null,null,null)$$,'42501',null,'an outsider cannot list bags');
reset role;
select is((select scope from connector_functions where function_name='bag_queue_page'),'reception:read','the bag queue is registered under the reception read scope');
select * from finish();
rollback;
