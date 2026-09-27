begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d1620000-0000-4000-8000-000000009901','unified-owner@example.test',now()),
 ('d1620000-0000-4000-8000-000000009902','unified-reader@example.test',now()),
 ('d1620000-0000-4000-8000-000000009903','unified-other@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1620000-0000-4000-8000-000000009901","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Unified items','unified-items',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','','123')::text,true);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Mixed',null)::text,true);
select set_config('test.otherbag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Other',null)::text,true);
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)->>'total','0','empty handover is empty');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
do $$ declare origin uuid; item uuid; begin for n in 1..30 loop
 origin:=gen_random_uuid(); item:=gen_random_uuid();
 if n%2=0 then
  perform create_bag_reception(current_setting('test.tenant')::uuid,origin,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
  perform quick_receive_from_bag(current_setting('test.tenant')::uuid,item,origin,current_setting('test.seller')::uuid,0,jsonb_build_object('description','Quick item '||n),10000+n,current_setting('test.bag')::uuid);
 else
  perform save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,origin,0,'Draft item '||n,'','Good');
  perform accept_item(current_setting('test.tenant')::uuid,item,'inspection_draft',origin,1,20000+n);
  perform set_inspection_archived(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,origin,1,true,'Synthetic archived accepted draft');
 end if;
end loop; end $$;
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,gen_random_uuid(),0,'Unaccepted','','Good');
-- Populated unrelated origins must not leak into this handover.
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',15000,'Synthetic receipt',false)::text,true);
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,20000);
select set_config('test.otherdraft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.otherbag')::uuid,current_setting('test.otherdraft')::uuid,0,'Other bag item','','Good');
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',current_setting('test.otherdraft')::uuid,1,17000);
select set_config('test.page1',bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)::text,true);
select set_config('test.page2',bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,25)::text,true);
select is(current_setting('test.page1')::jsonb->>'total',bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'accepted','list and summary count the same accepted facts');
select is(current_setting('test.page1')::jsonb->>'total','30','both accepted origins count; unaccepted drafts, purchases and other bags do not');
select is(jsonb_array_length(current_setting('test.page1')::jsonb->'items'),25,'first page bounded');
select is(jsonb_array_length(current_setting('test.page2')::jsonb->'items'),5,'second page reaches remaining items');
select is((select count(distinct x->>'id')::int from jsonb_array_elements((current_setting('test.page1')::jsonb->'items')||(current_setting('test.page2')::jsonb->'items')) x),30,'same timestamp pagination has no duplicate or missing items');
select is((select count(*)::int from jsonb_array_elements((current_setting('test.page1')::jsonb->'items')||(current_setting('test.page2')::jsonb->'items')) x where x->>'session_id' is null and x->>'title' like 'Draft item %' and x->>'photo_id' is null),15,'archived accepted drafts remain visible with title and no invented session or photo');
select is((select count(*)::int from jsonb_array_elements((current_setting('test.page1')::jsonb->'items')||(current_setting('test.page2')::jsonb->'items')) x where x->>'session_id' is not null and x->>'title' like 'Quick item %'),15,'quick item session and title retained');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0),current_setting('test.page1')::jsonb,'stable read order');
select is(bag_received_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)->>'total','15','old quick-only RPC contract retained');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid,0)->>'total','1','another handover contains only its own accepted item');
select is(jsonb_array_length(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,100)->'items'),0,'out-of-range page empty');
select throws_like($$select bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,-1)$$,'%INVALID_INPUT%','negative offset rejected');
select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_setting('test.page1')::jsonb->'items'->0->>'id')::uuid,12345,'Synthetic current price');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)->'items'->0->>'price_ore','12345','current price exact');
select set_config('test.otherTenant',create_tenant('Other unified items','other-unified-items',gen_random_uuid())::text,true);
select throws_like($$select bag_registered_items_page(current_setting('test.otherTenant')::uuid,current_setting('test.bag')::uuid,0)$$,'%BAG_NOT_FOUND%','owner of both tenants cannot mix tenant and bag');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'d1620000-0000-4000-8000-000000009902','readonly'),(current_setting('test.otherTenant')::uuid,'d1620000-0000-4000-8000-000000009903','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1620000-0000-4000-8000-000000009902","role":"authenticated"}';
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)->>'total','30','readonly can browse both origins');
set local "request.jwt.claims"='{"sub":"d1620000-0000-4000-8000-000000009903","role":"authenticated"}';
select throws_ok($$select bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)$$,'42501',null,'another tenant member denied');
reset role;
select ok(not has_function_privilege('anon','public.bag_registered_items_page(uuid,uuid,integer)','execute'),'anonymous denied');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'d1620000-0000-4000-8000-000000009901','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1620000-0000-4000-8000-000000009901","role":"authenticated","aal":"aal1"}';
select throws_ok($$select bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)$$,'42501',null,'MFA required');
reset role;
select * from finish(); rollback;
