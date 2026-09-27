begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Owner A (941), owner B (942), admin/staff/readonly members of A (943-945), a non-member (946).
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000941','lqp-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000942','lqp-other-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000943','lqp-admin@example.test',now()),
 ('f0000000-0000-4000-8000-000000000944','lqp-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000945','lqp-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000000946','lqp-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000941","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Lifecycle page','lifecycle-page-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@lqp.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","markdownSteps":[{"afterDays":14,"percent":10}]}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
-- Twenty-five items with deterministic ids so the accepted_at, id order is known:
-- 01..23 "Blue lamp NN", 24 "Literal% item", 25 "Under_score item".
do $$
declare n int; draft uuid; title text;
begin
 for n in 1..25 loop
  draft:=gen_random_uuid();
  title:=case n when 24 then 'Literal% item' when 25 then 'Under_score item' else 'Blue lamp '||lpad(n::text,2,'0') end;
  perform save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,draft,0,title,'Lamps','Good');
  perform accept_item(current_setting('test.tenant')::uuid,('a1680000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'inspection_draft',draft,1,10000+n*100);
 end loop;
end $$;
-- Store B with one item of its own.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select set_config('test.other',create_tenant('Lifecycle page other','lifecycle-page-other',gen_random_uuid())::text,true);
select set_config('test.other_seller',register_seller(current_setting('test.other')::uuid,gen_random_uuid(),'Other seller','o@lqp.test','')::text,true);
select set_config('test.other_agreement',publish_seller_agreement(current_setting('test.other')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.other_seller')::uuid,current_setting('test.other_agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.other')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.other')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.other_bag',receive_bag_with_agreement(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.other_seller')::uuid,'',current_setting('test.other_agreement')::uuid)::text,true);
select set_config('test.other_draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.other_bag')::uuid,current_setting('test.other_draft')::uuid,0,'Blue lamp other','Lamps','Good');
select accept_item(current_setting('test.other')::uuid,'b1680000-0000-4000-8000-000000000001','inspection_draft',current_setting('test.other_draft')::uuid,1,9900);
-- Three items of store A are past step one; the rest are on sale. Members of A.
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=accepted_at-interval '15 days' where id in ('a1680000-0000-4000-8000-000000000001','a1680000-0000-4000-8000-000000000002','a1680000-0000-4000-8000-000000000003');
alter table public.items enable trigger items_immutable;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000943','admin'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000944','staff'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000945','readonly');
select set_config('test.access_before',(select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid)::text,true);
select set_config('test.events_before',(select count(*) from item_events where tenant_id=current_setting('test.tenant')::uuid)::text,true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000941","role":"authenticated"}';
-- Paging: 25 rows, twenty then five, stable order, empty beyond the end.
select set_config('test.p0',lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)::text,true);
select set_config('test.p20',lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,20)::text,true);
select is((current_setting('test.p0')::jsonb->>'total')::int,25,'total counts every item of the store');
select is(jsonb_array_length(current_setting('test.p0')::jsonb->'rows'),20,'first page holds twenty rows');
select is((current_setting('test.p0')::jsonb->>'limit')::int,20,'limit is twenty');
select is((current_setting('test.p0')::jsonb->>'offset')::int,0,'offset echoed');
select is(jsonb_array_length(current_setting('test.p20')::jsonb->'rows'),5,'second page holds the remaining five');
select is((current_setting('test.p20')::jsonb->>'total')::int,25,'total is the same on every page');
select is(jsonb_array_length(lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,25)->'rows'),0,'offset at the end is empty');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,999)->>'total')::int,25,'offset past the end still reports the total');
select is(current_setting('test.p0')::jsonb->'rows'->0->>'item_id','a1680000-0000-4000-8000-000000000001','the oldest item comes first');
select is(current_setting('test.p0')::jsonb->'rows'->3->>'item_id','a1680000-0000-4000-8000-000000000004','ties on accepted_at break on item id');
select is(current_setting('test.p20')::jsonb->'rows'->4->>'item_id','a1680000-0000-4000-8000-000000000025','the newest item comes last');
-- Parity with the legacy display read: identical rows, prices and stages.
select is(current_setting('test.p0')::jsonb->'rows',
 (select jsonb_agg(e order by o) from jsonb_array_elements(lifecycle_queue_display(current_setting('test.tenant')::uuid,null)) with ordinality x(e,o) where o<=20),
 'first page equals the first twenty legacy rows exactly');
select is(current_setting('test.p20')::jsonb->'rows',
 (select jsonb_agg(e order by o) from jsonb_array_elements(lifecycle_queue_display(current_setting('test.tenant')::uuid,null)) with ordinality x(e,o) where o>20),
 'second page equals the remaining legacy rows exactly');
select is(current_setting('test.p0')::jsonb->'rows'->0->>'stage','markdown_due','aged item is due');
select is((current_setting('test.p0')::jsonb->'rows'->0->>'due_step')::int,1,'first step is due');
select is((current_setting('test.p0')::jsonb->'rows'->0->>'current_price_ore')::bigint,(select current_price_ore from lifecycle_queue(current_setting('test.tenant')::uuid,null) where item_id='a1680000-0000-4000-8000-000000000001'),'price equals the legacy queue, itself item_lifecycle');
select is((current_setting('test.p0')::jsonb->'rows'->0->>'current_price_ore')::bigint,10100::bigint,'price is the accepted price, no markdown applied yet');
select is(current_setting('test.p0')::jsonb->'rows'->0->>'title','Blue lamp 01','title carried');
select is(current_setting('test.p0')::jsonb->'rows'->5->>'stage','on_sale','fresh item is on sale');
-- The due count is store-wide whatever the filters say.
select is((current_setting('test.p0')::jsonb->>'dueCount')::int,3,'three due steps in the store');
select set_config('test.sold',lifecycle_queue_page(current_setting('test.tenant')::uuid,'',  'sold',0)::text,true);
select is((current_setting('test.sold')::jsonb->>'total')::int,0,'no sold items');
select is(jsonb_array_length(current_setting('test.sold')::jsonb->'rows'),0,'sold filter returns no rows');
select is((current_setting('test.sold')::jsonb->>'dueCount')::int,3,'due count unchanged by the stage filter');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'does not exist',null,0)->>'dueCount')::int,3,'due count unchanged by a query that matches nothing');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'does not exist',null,0)->>'total')::int,0,'a query that matches nothing has zero total');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',  'markdown_due',0)->>'total')::int,3,'stage filter counts only that stage');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',  'on_sale',0)->>'total')::int,22,'the rest are on sale');
-- Literal, case-insensitive search on title, full id and label prefix.
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'BLUE lamp 0',null,0)->>'total')::int,9,'title search is case-insensitive');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'  blue lamp 1 ',null,0)->>'total')::int,10,'query is trimmed');
select is(lifecycle_queue_page(current_setting('test.tenant')::uuid,'%',null,0)->'rows'->0->>'title','Literal% item','percent is literal');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'%',null,0)->>'total')::int,1,'percent matches one title');
select is(lifecycle_queue_page(current_setting('test.tenant')::uuid,'_',null,0)->'rows'->0->>'title','Under_score item','underscore is literal');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'a1680000-0000-4000-8000-000000000007',null,0)->>'total')::int,1,'full id matches one item');
select is(lifecycle_queue_page(current_setting('test.tenant')::uuid,'A1680000-0000-4000-8000-000000000007',null,0)->'rows'->0->>'title','Blue lamp 07','id search is case-insensitive and returns the title');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'I-A1680000',null,0)->>'total')::int,25,'label prefix matches every item sharing it');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'i-a1680000',  'markdown_due',0)->>'total')::int,3,'label search combines with the stage filter');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'blue lamp 0',null,5)->>'total')::int,9,'total ignores the offset');
select is(jsonb_array_length(lifecycle_queue_page(current_setting('test.tenant')::uuid,'blue lamp 0',null,5)->'rows'),4,'offset applies within the matches');
-- Bad input is refused, not silently corrected.
select throws_like($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'','bogus',0)$$,'%INVALID_INPUT%','unknown stage refused');
select throws_like($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,-1)$$,'%INVALID_INPUT%','negative offset refused');
select throws_like($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,null)$$,'%INVALID_INPUT%','null offset refused');
select throws_like($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,repeat('x',121),null,0)$$,'%INVALID_INPUT%','overlong query refused');
select lives_ok($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,repeat('x',120),null,0)$$,'120 characters allowed');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,null,null,0)->>'total')::int,25,'null query reads as empty');
-- Every store role reads; outsiders, the other store''s owner and anon do not.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000943","role":"authenticated"}';
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)->>'total')::int,25,'admin reads the page');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000944","role":"authenticated"}';
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)->>'total')::int,25,'staff reads the page');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000945","role":"authenticated"}';
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)->>'dueCount')::int,3,'readonly reads the page and the due count');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000946","role":"authenticated"}';
select throws_ok($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)$$,'42501',null,'a non-member is refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select throws_ok($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)$$,'42501',null,'the other store''s owner is refused');
select is((lifecycle_queue_page(current_setting('test.other')::uuid,'blue lamp',null,0)->>'total')::int,1,'the other store sees only its own item');
select is(lifecycle_queue_page(current_setting('test.other')::uuid,'',null,0)->'rows'->0->>'item_id','b1680000-0000-4000-8000-000000000001','and never a row of store A');
set local role anon;
select throws_ok($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)$$,'42501',null,'anon is refused');
-- Reading wrote nothing.
reset role;
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid)::text,current_setting('test.access_before'),'no access event recorded by reads');
select is((select count(*) from item_events where tenant_id=current_setting('test.tenant')::uuid)::text,current_setting('test.events_before'),'no item event recorded by reads');
select * from finish();
rollback;
