begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7100000-0000-4000-8000-000000000001','offer-staff@example.test',now(),null,null),
 ('f7100000-0000-4000-8000-000000000002',null,null,'46700007102',now()),
 ('f7100000-0000-4000-8000-000000000003',null,null,'46700007103',now()),
 ('f7100000-0000-4000-8000-000000000004','offer-reader@example.test',now(),null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"f7100000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic offer recipient','synthetic-offer-recipient',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f7100000-0000-4000-8000-000000000101',null,'Synthetic agreement 1','Original synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f7100000-0000-4000-8000-000000000004','readonly');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7100000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f7100000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7100000-0000-4000-8000-000000000002/f7100000-0000-4000-8000-000000000201.jpg');
select submit_external_item_request('f7100000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',100000,'SEK',array['f7100000-0000-4000-8000-000000000201']::uuid[],'SE');

select is(my_external_item_requests()#>>'{requests,0,price_basis}','resale','legacy price keeps its original meaning');
select submit_external_item_request('f7100000-0000-4000-8000-000000000302',:'tenant','New wish','','good','',40000,'SEK',array['f7100000-0000-4000-8000-000000000201']::uuid[],'SE','seller_amount');
select is((select price_basis from external_item_requests where id='f7100000-0000-4000-8000-000000000302'),'seller_amount','new wish is explicitly seller compensation');
select lives_ok(format($$select submit_external_item_request('f7100000-0000-4000-8000-000000000302',%L,'New wish','','good','',40000,'SEK',array['f7100000-0000-4000-8000-000000000201']::uuid[],'SE','seller_amount')$$,:'tenant'),'exact retry preserves meaning');
select throws_like(format($$select submit_external_item_request('f7100000-0000-4000-8000-000000000302',%L,'New wish','','good','',40000,'SEK',array['f7100000-0000-4000-8000-000000000201']::uuid[],'SE')$$,:'tenant'),'%REQUEST_CONFLICT%','legacy retry cannot reinterpret compensation');
set local request.jwt.claims='{"sub":"f7100000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select r->>'desired_price_ore' from jsonb_array_elements(external_item_offer_queue(:'tenant')->'rows') r where r->>'id'='f7100000-0000-4000-8000-000000000301'),null::text,'staff ignore legacy resale wishes');
select is((select r->>'desired_price_ore' from jsonb_array_elements(external_item_offer_queue(:'tenant')->'rows') r where r->>'id'='f7100000-0000-4000-8000-000000000302'),'40000','staff see the seller compensation wish');
reset role;
select throws_like($$update external_item_requests set price_basis='seller_amount' where id='f7100000-0000-4000-8000-000000000301'$$,'%IMMUTABLE%','historical meaning cannot be edited');
select * from finish(); rollback;
