begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000371','markdown-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000372','markdown-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000371","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Markdown agent test','markdown-agent-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@markdown.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
-- The switch is a validated optional boolean, off by default.
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"automaticMarkdowns":"yes"}')$$,'%INVALID_INPUT%','the switch must be a boolean');
select set_config('test.policy1',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}')::text,true);
select is(current_store_policy(current_setting('test.tenant')::uuid)->'policy'->'automaticMarkdowns',null,'absent means off');
-- Two accepted items, one aged past step one, one fresh.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Old jacket','Jackets','Good');
select set_config('test.old',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.old')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,40000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Fresh coat','Coats','Good');
select set_config('test.fresh',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.fresh')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,30000);
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=accepted_at-interval '15 days' where id=current_setting('test.old')::uuid;
alter table public.items enable trigger items_immutable;
-- The automatic run does nothing while the switch is off.
select is(jsonb_array_length(komisio_private.run_automatic_markdowns()->'runs'),0,'no store runs automatically while switched off');
select is((select count(*) from markdown_runs),0::bigint,'no run recorded');
-- A staff member applies everything due by hand: one item, one step.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000371","role":"authenticated"}';
select set_config('test.run1',gen_random_uuid()::text,true);
select set_config('test.res1',apply_due_markdowns(current_setting('test.tenant')::uuid,current_setting('test.run1')::uuid)::text,true);
select is((current_setting('test.res1')::jsonb->>'appliedCount')::int,1,'one due step applied');
select is(current_setting('test.res1')::jsonb->'applied'->0->>'itemId',current_setting('test.old'),'the aged item');
select is((current_setting('test.res1')::jsonb->'applied'->0->>'priceOre')::bigint,36000::bigint,'ten percent off the accepted price');
select is((select price_ore from item_prices where item_id=current_setting('test.old')::uuid order by seq desc limit 1),36000::bigint,'the price series carries the markdown');
select is((select actor from item_events where item_id=current_setting('test.old')::uuid and kind='markdown_applied'),'f0000000-0000-4000-8000-000000000371'::uuid,'the event names the staff member');
select is((select mode||'|'||applied_count from markdown_runs where id=current_setting('test.run1')::uuid),'manual|1','the run is recorded as manual');
select is((apply_due_markdowns(current_setting('test.tenant')::uuid,current_setting('test.run1')::uuid)->>'replayed')::boolean,true,'replay returns the run');
select is((select count(*) from item_events where item_id=current_setting('test.old')::uuid and kind='markdown_applied'),1::bigint,'replay applied nothing more');
select set_config('test.run2',gen_random_uuid()::text,true);
select is((apply_due_markdowns(current_setting('test.tenant')::uuid,current_setting('test.run2')::uuid)->>'appliedCount')::int,0,'a second run finds nothing due');
select throws_ok($$select apply_due_markdowns(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'another tenant denied');
select throws_ok($$select komisio_private.run_automatic_markdowns()$$,'42501',null,'a session role cannot run the automatic agent');
-- The owner switches automatic markdowns on; the agent acts as that owner.
select set_config('test.policy2',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.policy1')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"automaticMarkdowns":true}')::text,true);
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=accepted_at-interval '15 days' where id=current_setting('test.old')::uuid;
update public.items set accepted_at=accepted_at-interval '15 days' where id=current_setting('test.fresh')::uuid;
alter table public.items enable trigger items_immutable;
select set_config('test.auto',komisio_private.run_automatic_markdowns()::text,true);
select is(jsonb_array_length(current_setting('test.auto')::jsonb->'runs'),1,'one store ran');
select is((current_setting('test.auto')::jsonb->'runs'->0->>'appliedCount')::int,2,'step two on the old item, step one on the fresh one');
select is((select price_ore from item_prices where item_id=current_setting('test.old')::uuid order by seq desc limit 1),30000::bigint,'twenty-five percent of the accepted price, not compounded');
select is((select price_ore from item_prices where item_id=current_setting('test.fresh')::uuid order by seq desc limit 1),27000::bigint,'ten percent on the fresh item');
select is((select actor from item_events where item_id=current_setting('test.fresh')::uuid and kind='markdown_applied'),'f0000000-0000-4000-8000-000000000371'::uuid,'automatic markdowns act as the owner who enabled them');
select is((select actor from markdown_runs where tenant_id=current_setting('test.tenant')::uuid and mode='automatic'),'f0000000-0000-4000-8000-000000000371'::uuid,'the automatic run is attributed to the owner who enabled it');
select is((komisio_private.run_automatic_markdowns()->'runs'->0->>'replayed')::boolean,true,'a second run the same day replays');
select is((select count(*) from markdown_runs where tenant_id=current_setting('test.tenant')::uuid and mode='automatic'),1::bigint,'one automatic run per store and day');
select throws_ok($$update markdown_runs set applied_count=9$$,'55000',null,'runs are immutable');
select * from finish();
rollback;
