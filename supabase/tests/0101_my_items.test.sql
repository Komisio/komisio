begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001011','mi-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000001012','mi-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000001013','mi-other@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001011","role":"authenticated"}';
select set_config('test.tenant',create_tenant('My items test','my-items-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','mi-seller@example.test','')::text,true);
select set_config('test.other',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Bo Berg','mi-other@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.other')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
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
-- The other seller's item must never appear.
select set_config('test.bag2',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.other')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d3',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag2')::uuid,current_setting('test.d3')::uuid,0,'Other hat','Hats','Good');
select set_config('test.i3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid,'inspection_draft',current_setting('test.d3')::uuid,1,5000);

set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001012","role":"authenticated"}';
select set_config('test.r',my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is(current_setting('test.r')::jsonb->>'currency','SEK','store currency');
select is(jsonb_array_length(current_setting('test.r')::jsonb->'items'),2,'only the seller''s own items');
create function pg_temp.mine(item text) returns jsonb language sql stable as $$ select e from jsonb_array_elements(current_setting('test.r')::jsonb->'items') e where e->>'id'=current_setting(item) $$;
select is(pg_temp.mine('test.i1')->>'title','Blue wool jacket','title from the origin');
select is(pg_temp.mine('test.i1')->>'stage','sold','sold stage');
select is((pg_temp.mine('test.i1')->>'soldPriceOre')::bigint,18000::bigint,'sold price');
select is((pg_temp.mine('test.i1')->>'soldAt')::timestamptz,'2026-09-10T10:00:00Z'::timestamptz,'sold at');
select is((pg_temp.mine('test.i1')->>'acceptedPriceOre')::bigint,20000::bigint,'accepted price kept');
select is(pg_temp.mine('test.i2')->>'stage','on_sale','unsold coat on sale');
select is((pg_temp.mine('test.i2')->>'currentPriceOre')::bigint,30000::bigint,'current price');
select is(pg_temp.mine('test.i2')->>'endOfPeriodAction','charity','what happens at period end');
select ok((pg_temp.mine('test.i2')->>'periodEnd')::timestamptz>now(),'period end ahead');
select is(pg_temp.mine('test.i2')->>'soldAt',null,'no sale for the coat');
select is(pg_temp.mine('test.i2')->>'reference','I-'||upper(left(current_setting('test.i2'),8)),'reference as on labels');
select ok(current_setting('test.r')::text not like '%Other hat%','nothing from the other seller');
select ok(current_setting('test.r')::text not like '%Good%','condition and staff notes are not exposed');
select throws_ok($$select my_items(current_setting('test.tenant')::uuid,current_setting('test.other')::uuid)$$,'42501',null,'another seller''s items refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001013","role":"authenticated"}';
select throws_ok($$select my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'42501',null,'a different account is refused');
select * from finish();
