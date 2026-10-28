begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000721','history-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000722','history-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000000723','history-empty@example.test',now()),
 ('f0000000-0000-4000-8000-000000000724','history-business@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000721","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Synthetic history','synthetic-financial-history',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','history-seller@example.test','')::text,true);
select set_config('test.empty',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Empty seller','history-empty@example.test','')::text,true);
select adjust_seller_ledger(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,200000,'Private synthetic staff reason');
do $$ begin
 for i in 1..105 loop
  perform request_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,10000);
  perform issue_statement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,
   '2000-01-01'::timestamptz+(i-1)*interval '1 day','2000-01-01'::timestamptz+i*interval '1 day');
 end loop;
end $$;
select set_config('test.first', (select id::text from payouts where tenant_id=current_setting('test.tenant')::uuid order by requested_at desc,id limit 1),true);
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.first')::uuid);
select mark_payout_paid(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.first')::uuid,'Synthetic transfer reference');
select set_config('test.original',(select id::text from settlement_statements where tenant_id=current_setting('test.tenant')::uuid order by number desc limit 1),true);
select set_config('test.correction',issue_statement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'2000-04-14','2000-04-15',current_setting('test.original')::uuid)::text,true);
select set_config('test.otherstatement',issue_statement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.empty')::uuid,'2001-01-01','2001-01-02')::text,true);
select set_config('test.bank',gen_random_uuid()::text,true);
select set_config('test.statement.snapshot',(select jsonb_agg(to_jsonb(s) order by number)::text from settlement_statements s where tenant_id=current_setting('test.tenant')::uuid),true);
select set_config('test.balance',seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000722","role":"authenticated"}';
select set_config('test.p0',my_seller_payouts_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select set_config('test.p100',my_seller_payouts_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,100)::text,true);
select set_config('test.s0',my_seller_statements_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)::text,true);
select is((current_setting('test.p0')::jsonb->>'total')::int,105,'complete payout count exceeds old cap');
select is(jsonb_array_length(current_setting('test.p0')::jsonb->'payouts'),25,'payout page bounded to 25');
select is(jsonb_array_length(current_setting('test.p100')::jsonb->'payouts'),5,'payouts beyond first hundred reachable');
select is(current_setting('test.p0')::jsonb->'balance',current_setting('test.balance')::jsonb,'balance is the existing engine fact after real paid transition');
select is(current_setting('test.p0')::jsonb->'balance'->>'paidOre','10000','paid amount remains recorded fact');
select is(current_setting('test.p0')::jsonb->>'thresholdOre','10000','existing threshold is unchanged');
select is(current_setting('test.p0')::jsonb->>'currency','SEK','store currency returned');
select is(current_setting('test.p0')::jsonb->'payouts'->0->>'id',current_setting('test.first'),'timestamp ties use stable id ordering');
select is(current_setting('test.p0')::jsonb->'payouts'->0->>'status','paid','actual payout status, not inferred from balance');
select is(current_setting('test.p0')::jsonb->'payouts'->0->>'request_source','staff','original request source preserved');
select ok(not ((current_setting('test.p0')::jsonb->'payouts'->0) ?| array['payment_reference','requested_by','bank','paid_at']),'page omits actor, bank and transfer details; timestamp is request time only');
select is((select count(distinct row->>'id')::int from generate_series(0,100,25) n cross join lateral jsonb_array_elements(my_seller_payouts_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,n)->'payouts') row),105,'all payout pages are disjoint and complete in one snapshot');
select is(current_setting('test.s0')::jsonb->>'total','106','all issued statements including correction counted');
select is(current_setting('test.s0')::jsonb->'statements'->0->>'id',current_setting('test.correction'),'statement numbers descend');
select is(current_setting('test.s0')::jsonb->'statements'->0->>'corrects_id',current_setting('test.original'),'correction keeps original link');
select is(current_setting('test.s0')::jsonb->'statements'->0->>'kind','credit_note','correction type retained');
select is(current_setting('test.s0')::jsonb->'statements'->0->>'is_self_billing','false','private statement not relabelled as self invoice');
select ok(not ((current_setting('test.s0')::jsonb->'statements'->0) ?| array['seller_contact','self_billing','lines','issued_by','tenant_id','seller_id']),'summary excludes frozen identities and document bodies');
select is((select count(distinct row->>'id')::int from generate_series(0,100,25) n cross join lateral jsonb_array_elements(my_seller_statements_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,n)->'statements') row),106,'all statement pages beyond hundred are reachable');
select is((my_seller_statement(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.correction')::uuid)->'header'->>'corrects_id'),current_setting('test.original'),'existing exact document detail still used');
select is(jsonb_array_length(my_seller_statements_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,200)->'statements'),0,'past-end page is empty');
select is(my_seller_statements_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,200)->>'total','106','past-end page retains total');
select is((select count(*) from payouts),0::bigint,'no raw payout grant to seller');
select is((select count(*) from settlement_statements),0::bigint,'no raw statement grant to seller');
select throws_ok(format('select %I(current_setting(''test.tenant'')::uuid,current_setting(''test.empty'')::uuid)',fn),'42501',null,fn||' denies another account') from unnest(array['my_seller_payouts_page','my_seller_statements_page']) fn;
select throws_ok(format('select %I(gen_random_uuid(),current_setting(''test.seller'')::uuid)',fn),'42501',null,fn||' denies another tenant') from unnest(array['my_seller_payouts_page','my_seller_statements_page']) fn;
select throws_ok(format('select %I(current_setting(''test.tenant'')::uuid,current_setting(''test.seller'')::uuid,%L::integer)',fn,n),'P0001','INVALID_INPUT',fn||' rejects invalid offset') from unnest(array['my_seller_payouts_page','my_seller_statements_page']) fn cross join (values(null::int),(-1),(2500001)) invalid(n);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000723","role":"authenticated"}';
select is(my_seller_payouts_page(current_setting('test.tenant')::uuid,current_setting('test.empty')::uuid)->>'total','0','empty account has zero payouts');
select is(my_seller_payouts_page(current_setting('test.tenant')::uuid,current_setting('test.empty')::uuid)->'balance'->>'availableOre','0','empty balance is a real zero');
select is(my_seller_statements_page(current_setting('test.tenant')::uuid,current_setting('test.empty')::uuid)->>'total','1','other seller sees only their one statement');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000722','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000722","role":"authenticated","aal":"aal1"}';
select throws_ok(format('select %I(current_setting(''test.tenant'')::uuid,current_setting(''test.seller'')::uuid)',fn),'42501',null,fn||' requires MFA') from unnest(array['my_seller_payouts_page','my_seller_statements_page']) fn;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000722","role":"authenticated","aal":"aal2"}';
select lives_ok($$select my_seller_payouts_page(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)$$,'verified MFA reads payouts');
set local role anon;
select throws_ok(format('select %I(current_setting(''test.tenant'')::uuid,current_setting(''test.seller'')::uuid)',fn),'42501',null,fn||' denies anonymous') from unnest(array['my_seller_payouts_page','my_seller_statements_page']) fn;
reset role;
select is((select jsonb_agg(to_jsonb(s) order by number) from settlement_statements s where tenant_id=current_setting('test.tenant')::uuid),current_setting('test.statement.snapshot')::jsonb,'reads leave every frozen statement fact untouched');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000721","role":"authenticated"}';
select set_config('test.business',gen_random_uuid()::text,true);
select register_seller_with_profile(current_setting('test.tenant')::uuid,current_setting('test.business')::uuid,
 '{"name":"Synthetic business","email":"history-business@example.test","phone":"","addressLine1":"","addressLine2":"","postalCode":"","city":"","country":"","language":"en","notes":"","sellerType":"business"}');
select set_config('test.invoice',issue_statement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.business')::uuid,'2002-01-01','2002-01-02')::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000724","role":"authenticated"}';
select is(my_seller_statements_page(current_setting('test.tenant')::uuid,current_setting('test.business')::uuid)->'statements'->0->>'is_self_billing','true','business invoice marker comes from issued snapshot');
select is(my_seller_statement(current_setting('test.tenant')::uuid,current_setting('test.business')::uuid,current_setting('test.invoice')::uuid)->'header'->'self_billing'->>'currency','SEK','exact detail retains frozen invoice currency');
-- Ambiguous seller linkage still uses the existing fail-closed guard.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000721","role":"authenticated"}';
select register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Duplicate seller','history-seller@example.test','');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000722","role":"authenticated","aal":"aal2"}';
select throws_ok(format('select %I(current_setting(''test.tenant'')::uuid,current_setting(''test.seller'')::uuid)',fn),'42501',null,fn||' denies ambiguous email binding') from unnest(array['my_seller_payouts_page','my_seller_statements_page']) fn;
reset role;
select * from finish();
rollback;
