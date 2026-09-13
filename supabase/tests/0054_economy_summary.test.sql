begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000321','economy-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000322','economy-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000321","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Economy test','economy-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@economy.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
-- Three items: one sold in August, two sold in September, one of them returned.
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,50000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,30000);
select set_config('test.d3',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d3')::uuid,0,'Scarf','Accessories','Good');
select set_config('test.i3',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i3')::uuid,'inspection_draft',current_setting('test.d3')::uuid,1,20000);
select set_config('test.s1',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'manual','K-1','2026-08-01T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',50000)));
select set_config('test.s2',gen_random_uuid()::text,true);
select record_sale(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,'manual','K-2','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'priceOre',30000),jsonb_build_object('itemId',current_setting('test.i3'),'priceOre',20000)));
select set_config('test.line3',(select id::text from sale_lines where sale_id=current_setting('test.s2')::uuid and item_id=current_setting('test.i3')::uuid),true);
select record_return(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.line3')::uuid,20000,'Did not fit','2026-09-12T10:00:00Z');
-- One payout paid in September, one still requested.
select set_config('test.p1',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p1')::uuid,current_setting('test.seller')::uuid,10000);
select approve_payout(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,'');
select mark_payout_paid(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,'BG 1','');
select set_config('test.p2',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.p2')::uuid,current_setting('test.seller')::uuid,10000);
select set_config('test.sep',economy_summary(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')::text,true);
select set_config('test.all',economy_summary(current_setting('test.tenant')::uuid,'2026-08-01','2026-09-30')::text,true);
-- September: one sale with two lines, one return, the paid payout (paid now, today is in the period only if now is September; use the whole range for it).
select is((current_setting('test.sep')::jsonb->'totals'->>'salesCount')::int,1,'september has one sale');
select is((current_setting('test.sep')::jsonb->'totals'->>'linesCount')::int,2,'with two lines');
select is((current_setting('test.sep')::jsonb->'totals'->>'grossOre')::bigint,50000::bigint,'september gross is the sale, refunds are separate');
select is((current_setting('test.sep')::jsonb->'totals'->>'returnsCount')::int,1,'one return');
select is((current_setting('test.sep')::jsonb->'totals'->>'refundsOre')::bigint,20000::bigint,'refund amount');
select is((current_setting('test.sep')::jsonb->'totals'->>'netOre')::bigint,(current_setting('test.sep')::jsonb->'totals'->>'grossOre')::bigint-(current_setting('test.sep')::jsonb->'totals'->>'vatOre')::bigint,'net is gross minus VAT');
select is(jsonb_array_length(current_setting('test.sep')::jsonb->'days'),1,'one selling day in september');
select is(current_setting('test.sep')::jsonb->'days'->0->>'date','2026-09-10','the day is local');
select is((current_setting('test.all')::jsonb->'totals'->>'salesCount')::int,2,'the whole range has both sales');
select is((current_setting('test.all')::jsonb->'totals'->>'grossOre')::bigint,100000::bigint,'gross over the range');
select is((current_setting('test.all')::jsonb->'totals'->>'sellerCreditOre')::bigint,(select sum(seller_credit_ore)::bigint from sale_lines where tenant_id=current_setting('test.tenant')::uuid),'seller credit equals the frozen lines');
select is((current_setting('test.all')::jsonb->'totals'->>'creditReversedOre')::bigint,(select seller_credit_ore from sale_lines where id=current_setting('test.line3')::uuid),'the return reversed the line credit');
-- The same day, the same sums as the day close.
reset role;
select is(current_setting('test.sep')::jsonb->'totals'->'perMode',komisio_private.day_close_totals(current_setting('test.tenant')::uuid,'2026-09-10')->'perMode','per-mode totals agree with the day close');
select is((economy_summary(current_setting('test.tenant')::uuid,'2026-09-10','2026-09-10')->'totals')-'linesCount'-'netOre'-'payoutsPaidCount',komisio_private.day_close_totals(current_setting('test.tenant')::uuid,'2026-09-10'),'one-day summary equals the day close totals');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000321","role":"authenticated"}';
-- Liability and open payouts are current, not per period.
select is((current_setting('test.sep')::jsonb->'liability'->>'availableOre')::bigint,(seller_balance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid)->>'availableOre')::bigint,'liability is the sum of seller balances');
select is((current_setting('test.sep')::jsonb->'liability'->>'reservedOre')::bigint,0::bigint,'nothing reserved: the open payout is only requested');
select is((current_setting('test.sep')::jsonb->'openPayouts'->>'count')::int,1,'one open payout');
select is((current_setting('test.sep')::jsonb->'openPayouts'->>'amountOre')::bigint,10000::bigint,'open payout amount');
select is((economy_summary(current_setting('test.tenant')::uuid,(now() at time zone 'Europe/Stockholm')::date,(now() at time zone 'Europe/Stockholm')::date)->'totals'->>'payoutsPaidOre')::bigint,10000::bigint,'today shows the paid payout');
-- Boundaries.
select throws_like($$select economy_summary(current_setting('test.tenant')::uuid,'2026-09-30','2026-09-01')$$,'%INVALID_INPUT%','from after to refused');
select throws_like($$select economy_summary(current_setting('test.tenant')::uuid,'2025-01-01','2026-09-01')$$,'%INVALID_INPUT%','more than a year refused');
select throws_ok($$select economy_summary(gen_random_uuid(),'2026-09-01','2026-09-30')$$,'42501',null,'another tenant denied');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000322","role":"authenticated"}';
select throws_ok($$select economy_summary(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')$$,'42501',null,'a non-member is denied');
select * from finish();
rollback;
