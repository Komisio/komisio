begin;
\ir bag-reception-fixture.inc
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
  perform pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,draft,0,title,'Lamps','Good');
  perform accept_item(current_setting('test.tenant')::uuid,('a1680000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'reception_review',draft,1,10000+n*100);
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
select pg_temp.prepare_bag_reception(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.other_bag')::uuid,current_setting('test.other_draft')::uuid,0,'Blue lamp other','Lamps','Good');
select accept_item(current_setting('test.other')::uuid,'b1680000-0000-4000-8000-000000000001','reception_review',current_setting('test.other_draft')::uuid,1,9900);
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
-- A 26th row exercises the new second page and store-owned null seller.
select set_config('test.purchase',gen_random_uuid()::text,true);
select register_purchase(current_setting('test.tenant')::uuid,current_setting('test.purchase')::uuid,'A store item',5000,'Synthetic receipt',false);
select accept_item(current_setting('test.tenant')::uuid,'a1680000-0000-4000-8000-000000000026','purchase',current_setting('test.purchase')::uuid,null,25000);
-- A second seller verifies real name ordering, not just the id tie-break.
select set_config('test.alpha',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Alpha seller','alpha@lqp.test','')::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.alpha')::uuid,current_setting('test.agreement')::uuid,'Synthetic paper');
select set_config('test.alpha_bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.alpha')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.alpha_reception',gen_random_uuid()::text,true);
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.alpha_bag')::uuid,current_setting('test.alpha_reception')::uuid,0,'Other item','Furniture','Good');
select accept_item(current_setting('test.tenant')::uuid,'a1680000-0000-4000-8000-000000000027','reception_review',current_setting('test.alpha_reception')::uuid,1,17000);
create function pg_temp.table_page(q text default '',stage text default null,skip int default 0,sort text default 'accepted',direction text default 'asc') returns jsonb
language sql as $$ select public.lifecycle_queue_page(current_setting('test.tenant')::uuid,q,stage,skip,sort,direction,25) $$;
select is((pg_temp.table_page()->>'total')::int,27,'total spans both pages');
select is(jsonb_array_length(pg_temp.table_page()->'rows'),25,'first page has 25 rows');
select is(jsonb_array_length(pg_temp.table_page('',null,25)->'rows'),2,'second page has remaining row');
select is(pg_temp.table_page()->'rows'->0->>'item_id','a1680000-0000-4000-8000-000000000001','oldest first with stable id tie');
select is(pg_temp.table_page('',null,25)->'rows'->0->>'ownership','store','own purchase included');
select is(pg_temp.table_page('',null,25)->'rows'->0->>'seller_name',null,'store item has no seller name');
select is(pg_temp.table_page()->'rows'->0->>'seller_name','Seller','seller display name returned');
select is(pg_temp.table_page()->'rows'->0->>'category','Lamps','current category returned');
select is(pg_temp.table_page('',null,0,'title','asc')->'rows'->0->>'title','A store item','title ascending');
select is(pg_temp.table_page('',null,0,'title','desc')->'rows'->0->>'title','Under_score item','title descending');
select is(pg_temp.table_page('',null,0,'price','asc')->'rows'->0->>'current_price_ore','10100','price ascending uses numeric money');
select is(pg_temp.table_page('',null,0,'price','desc')->'rows'->0->>'current_price_ore','25000','price descending');
select is(pg_temp.table_page('',null,0,'stage','asc')->'rows'->0->>'stage','markdown_due','stage ascending');
select is(pg_temp.table_page('',null,0,'stage','desc')->'rows'->0->>'stage','on_sale','stage descending');
select is(pg_temp.table_page('',null,0,'accepted','desc')->'rows'->0->>'item_id','a1680000-0000-4000-8000-000000000004','newest acceptance first with ascending id tie');
select is(pg_temp.table_page('',null,0,'periodEnd','asc')->'rows'->0->>'item_id','a1680000-0000-4000-8000-000000000001','period end ascending');
select is(pg_temp.table_page('',null,0,'periodEnd','desc')->'rows'->0->>'item_id','a1680000-0000-4000-8000-000000000004','period end descending');
select is(pg_temp.table_page('',null,0,'seller','asc')->'rows'->0->>'seller_name','Alpha seller','seller name ascending');
select is(pg_temp.table_page('',null,26,'seller','desc')->'rows'->0->>'ownership','store','missing seller sorts last in descending order too');
select is((pg_temp.table_page('  BLUE LAMP 0 ','markdown_due')->>'total')::int,3,'trimmed case-insensitive search combines with stage');
select is((pg_temp.table_page('missing','sold')->>'dueCount')::int,3,'batch due count ignores every list filter');
select is((pg_temp.table_page('%')->>'total')::int,1,'percent search remains literal');
select is((pg_temp.table_page('I-A1680000')->>'total')::int,27,'label-prefix search remains available');
select is(jsonb_array_length(pg_temp.table_page('',null,100)->'rows'),0,'beyond-end page empty');
select is((lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0)->>'limit')::int,20,'legacy contract still has 20 rows');
select throws_like($$select pg_temp.table_page('',null,0,'invalid')$$,'%INVALID_INPUT%','invalid sort rejected');
select throws_like($$select pg_temp.table_page('',null,0,'title','invalid')$$,'%INVALID_INPUT%','invalid direction rejected');
select throws_like($$select pg_temp.table_page('','invalid')$$,'%INVALID_INPUT%','invalid stage rejected');
select throws_like($$select pg_temp.table_page('',null,-1)$$,'%INVALID_INPUT%','negative offset rejected');
select throws_like($$select pg_temp.table_page(repeat('x',121))$$,'%INVALID_INPUT%','overlong query rejected');
select throws_like($$select lifecycle_queue_page(current_setting('test.tenant')::uuid,'',null,0,'title','asc',20)$$,'%INVALID_INPUT%','wrong limit rejected');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000945","role":"authenticated"}';
select is((pg_temp.table_page()->>'total')::int,27,'readonly can read');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select throws_ok($$select pg_temp.table_page()$$,'42501',null,'other tenant owner cannot read');
select is((lifecycle_queue_page(current_setting('test.other')::uuid,'',null,0,'title','asc',25)->>'total')::int,1,'other tenant sees only its own item');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000946","role":"authenticated"}';
select throws_ok($$select pg_temp.table_page()$$,'42501',null,'nonmember cannot read');
select ok(not has_function_privilege('anon','public.lifecycle_queue_page(uuid,text,text,integer,text,text,integer)','execute'),'anonymous execute forbidden');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000941","role":"authenticated"}';
select is(pg_temp.table_page('',null,0,'seller','desc')->'rows'->0->>'seller_name','Seller','seller name descending');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000941','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000941","role":"authenticated","aal":"aal1"}';
select throws_ok($$select pg_temp.table_page()$$,'42501',null,'MFA remains enforced');
select * from finish();
rollback;
