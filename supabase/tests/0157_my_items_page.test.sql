begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001571','page-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000001572','page-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001571","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Next step test','seller-page-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','page-seller@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
-- Steps that are due at once, tomorrow, and after the period, so every branch can be read today.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')
 || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","salePeriodDays":42,"markdownSteps":[{"afterDays":0,"percent":10},{"afterDays":1,"percent":25},{"afterDays":60,"percent":50}]}'::jsonb);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Blue wool jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Red coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,30000);
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',18000)));

-- Create enough facts through the engine to cross the legacy200 cap.
do $$ declare n integer; draft uuid; begin for n in 1..201 loop
 draft:=gen_random_uuid();
 perform public.save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,draft,0,'Extra item '||n,'Other','Private staff detail');
 perform public.accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',draft,1,10000);
end loop; end $$;
select set_config('test.other',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Other seller','other-page@example.test','')::text,true);
select throws_ok(format('select public.my_items_page(%L,%L)',current_setting('test.tenant'),current_setting('test.seller')),'42501','FORBIDDEN','store membership does not grant seller identity');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001572","role":"authenticated"}';
select set_config('test.page',my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.page')::jsonb->>'total')::int,203,'count covers all own items');
select is(jsonb_array_length(current_setting('test.page')::jsonb->'items'),25,'first page is bounded');
select is((current_setting('test.page')::jsonb->>'offset')::int,0,'first offset');
select is(current_setting('test.page')::jsonb->>'currency','SEK','currency preserved');
select is((current_setting('test.page')::jsonb->>'automaticMarkdowns')::boolean,false,'manual markdown policy preserved');
select is(current_setting('test.page')::jsonb->'items',(select jsonb_agg(e order by ord) from jsonb_array_elements(my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->'items') with ordinality a(e,ord) where ord<=25),'all facts equal legacy first page including next steps');
select is(jsonb_array_length(my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'',200)->'items'),3,'items after the legacy200 cap remain accessible');
select is(jsonb_array_length(my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'',250)->'items'),0,'past end is empty');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'',250)->>'total')::int,203,'past end retains total');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,' red COAT ')->>'total')::int,1,'literal case-insensitive title search');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'coats')->>'total')::int,1,'category search');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'I-'||upper(left(current_setting('test.i2'),8)))->'items'->0->>'id'),current_setting('test.i2'),'printed reference search');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.i1'))->'items'->0->>'soldPriceOre')::bigint,18000::bigint,'UUID search preserves sale facts');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'red coat')->'items'->0->>'nextPriceOre')::bigint,27000::bigint,'search preserves planned price');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'%')->>'total')::int,0,'percent is literal not wildcard');
select is((my_items_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'_')->>'total')::int,0,'underscore is literal not wildcard');
select ok(current_setting('test.page') not like '%Private staff detail%','staff condition remains private');
select throws_ok(format('select public.my_items_page(%L,%L)',current_setting('test.tenant'),current_setting('test.other')),'42501','FORBIDDEN','another seller is denied');
select throws_ok(format('select public.my_items_page(%L,%L)',gen_random_uuid(),current_setting('test.seller')),'42501','FORBIDDEN','another tenant is denied');
select throws_ok(format('select public.my_items_page(%L,%L,%L,-1)',current_setting('test.tenant'),current_setting('test.seller'),''),'P0001','INVALID_INPUT','negative offset denied');
select throws_ok(format('select public.my_items_page(%L,%L,%L)',current_setting('test.tenant'),current_setting('test.seller'),repeat('x',121)),'P0001','INVALID_INPUT','oversized query denied');
reset role;
select ok(not has_function_privilege('anon','public.my_items_page(uuid,uuid,text,integer)','EXECUTE'),'anonymous read denied');
select * from finish();
rollback;
