begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001541','ns-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000001542','ns-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001541","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Next step test','next-step-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','ns-seller@example.test','')::text,true);
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
-- A later policy whose only step falls after the period: nothing is scheduled for an item accepted under it.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')
 || '{"markdownSteps":[{"afterDays":50,"percent":10}]}'::jsonb);
select set_config('test.d3',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d3')::uuid,0,'Green hat','Hats','Good');
select set_config('test.i3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid,'inspection_draft',current_setting('test.d3')::uuid,1,5000);

create function pg_temp.mine(item text) returns jsonb language sql stable as $$ select e from jsonb_array_elements(current_setting('test.r')::jsonb->'items') e where e->>'id'=current_setting(item) $$;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001542","role":"authenticated"}';
select set_config('test.r',my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.r')::jsonb->>'automaticMarkdowns')::boolean,false,'the store applies steps by hand');
select is(pg_temp.mine('test.i2')->>'stage','markdown_due','first step due at once');
select is((pg_temp.mine('test.i2')->>'nextMarkdownAt')::timestamptz,(pg_temp.mine('test.i2')->>'acceptedAt')::timestamptz,'next step falls on acceptance day');
select is((pg_temp.mine('test.i2')->>'nextMarkdownPercent')::numeric,10::numeric,'next step percent');
select is((pg_temp.mine('test.i2')->>'nextPriceOre')::bigint,27000::bigint,'next price is a share of the accepted price');
select is(pg_temp.mine('test.i1')->>'nextMarkdownAt',null,'a sold item has no next step');
select is(pg_temp.mine('test.i3')->>'nextMarkdownAt',null,'a step after the period end is not scheduled');
select is(pg_temp.mine('test.i3')->>'nextPriceOre',null,'and carries no price');

-- The store applies the due step: the portal moves to the second step and the price the engine recorded matches what it showed.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001541","role":"authenticated"}';
select apply_markdown(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i2')::uuid,1);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001542","role":"authenticated"}';
select set_config('test.r',my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((pg_temp.mine('test.i2')->>'currentPriceOre')::bigint,27000::bigint,'the recorded price equals the shown next price');
select is((pg_temp.mine('test.i2')->>'nextMarkdownAt')::timestamptz,(pg_temp.mine('test.i2')->>'acceptedAt')::timestamptz+interval '1 day','second step tomorrow');
select is((pg_temp.mine('test.i2')->>'nextPriceOre')::bigint,22500::bigint,'second price is not compounded on the first');
select is(pg_temp.mine('test.i2')->>'stage','on_sale','back on sale until the next step is due');

-- A manual price after the first step: the shown price is the engine's, the planned step still counts from the accepted price.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001541","role":"authenticated"}';
select set_item_price(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.i2')::uuid,28000,'Customer interest');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001542","role":"authenticated"}';
select set_config('test.r',my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((pg_temp.mine('test.i2')->>'currentPriceOre')::bigint,28000::bigint,'the manual price is the current price');
select is((pg_temp.mine('test.i2')->>'nextPriceOre')::bigint,22500::bigint,'the planned step is unchanged by the manual price');
select ok(current_setting('test.r')::text not like '%Customer interest%','the staff reason is not exposed');

-- Automatic markdowns switched on: the flag follows the current policy; frozen steps stay.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001541","role":"authenticated"}';
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"automaticMarkdowns":true}'::jsonb);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001542","role":"authenticated"}';
select set_config('test.r',my_items(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.r')::jsonb->>'automaticMarkdowns')::boolean,true,'automatic flag follows the policy');
select is((pg_temp.mine('test.i2')->>'nextPriceOre')::bigint,22500::bigint,'frozen steps unchanged by the policy change');
select ok(current_setting('test.r')::text not like '%Good%','condition and staff notes are still not exposed');
select * from finish();
