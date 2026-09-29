begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000961','detail-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000962','detail-outsider@example.test',now()),
 ('f0000000-0000-4000-8000-000000000963','actor-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000961","role":"authenticated"}';
select save_profile('Christer Nilsson','sv');
select set_config('test.tenant',create_tenant('Detail test','detail-reads-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@detail.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);

select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->'actor'->>'name','Christer Nilsson','acceptance actor name');
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'prices'->0->'actor'->>'id',auth.uid()::text,'price actor is recorded identity');
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'events'->0->'actor'->>'name','Christer Nilsson','event actor name');
select ok(not (item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->'actor' ? 'email'),'email not exposed');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000962','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000962","role":"authenticated"}';
select save_profile('Karin Svensson','sv');
select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,20000,'Synthetic actor test');
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'prices'->0->'actor'->>'name','Karin Svensson','manual price identifies its own actor');
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->'actor'->>'name','Christer Nilsson','acceptance retains different actor');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000961","role":"authenticated"}';
select save_profile('','sv');
select is(item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)->'item'->'actor'->>'name',null,'missing name stays unknown');
select is(item_detail(current_setting('test.tenant')::uuid,gen_random_uuid()),null,'unknown item reveals no names');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000963","role":"authenticated"}';
select throws_ok($$select item_detail(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)$$,'42501',null,'outside store cannot read actors');
select * from finish();
rollback;
