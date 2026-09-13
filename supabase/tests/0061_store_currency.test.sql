begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000381','currency-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000382','currency-seller@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000381","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Currency test','currency-test',gen_random_uuid())::text,true);
select is(store_currency(current_setting('test.tenant')::uuid),'SEK','a new store is in SEK');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"currency":"USD"}')$$,'%INVALID_INPUT%','only SEK, NOK, DKK and EUR');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"currency":1}')$$,'%INVALID_INPUT%','currency is a string');
-- Before any money fact the store may choose NOK.
select set_config('test.p1',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"currency":"NOK","vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}')::text,true);
select is(store_currency(current_setting('test.tenant')::uuid),'NOK','the store is now in NOK');
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','currency-seller@example.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Jacket','Jackets','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,50000);
-- A reception review must price in the store's currency.
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,'[{"id":"90000000-0000-4000-8000-000000000061","kind":"observation","reference":"TEST","observation":"Blue jacket"},{"id":"90000000-0000-4000-8000-000000000062","kind":"price-evidence","reference":"TEST appraisal","observation":"Fictional 400"}]'::jsonb);
select throws_like($$select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,
 '{"metadata":{"description":{"value":"Blue jacket","sourceIds":["90000000-0000-4000-8000-000000000061"],"certainty":"observed"}},"price":{"currency":"SEK","amount":"400.00","rationale":"Fictional","sourceIds":["90000000-0000-4000-8000-000000000062"]},"questions":[]}'::jsonb,now()+interval '1 day')$$,'%CURRENCY_MISMATCH%','a SEK price cannot be published in a NOK store');
select lives_ok($$select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,
 '{"metadata":{"description":{"value":"Blue jacket","sourceIds":["90000000-0000-4000-8000-000000000061"],"certainty":"observed"}},"price":{"currency":"NOK","amount":"400.00","rationale":"Fictional","sourceIds":["90000000-0000-4000-8000-000000000062"]},"questions":[]}'::jsonb,now()+interval '1 day')$$,'a NOK price publishes');
-- Sales, purchases and payouts carry the store's currency; a sale in another currency is refused.
select throws_like($$select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',50000)))$$,'%CURRENCY_MISMATCH%','a SEK sale is refused in a NOK store');
select set_config('test.sale',record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-10T10:00:00Z','NOK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',50000)))::text,true);
select is((select currency from sales where id=current_setting('test.sale')::uuid),'NOK','the sale records NOK');
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',10000,'Receipt 1',true)::text,true);
select is((select currency from purchase_receipts where id=current_setting('test.purchase')::uuid),'NOK','the purchase records NOK');
select set_config('test.payout',gen_random_uuid()::text,true);
select request_payout(current_setting('test.tenant')::uuid,current_setting('test.payout')::uuid,current_setting('test.seller')::uuid,10000);
select is((select currency from payouts where id=current_setting('test.payout')::uuid),'NOK','the payout records NOK');
select is(economy_summary(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')->>'currency','NOK','the economy summary names the currency');
-- Frozen: once money facts exist the currency cannot change, but the policy can otherwise.
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"currency":"DKK"}')$$,'%CURRENCY_FROZEN%','the currency is frozen after the first sale');
select throws_like($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') - 'currency')$$,'%CURRENCY_FROZEN%','dropping the key would mean SEK, also refused');
select lives_ok($$select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.p1')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"salePeriodDays":60}')$$,'other policy changes still publish');
select is(store_currency(current_setting('test.tenant')::uuid),'NOK','still NOK');
-- Zettle: a receipt in another currency is structurally valid but never recorded.
reset role;
select is(komisio_private.valid_zettle_purchase('{"externalId":"0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f","occurredAt":"2026-09-10T10:00:00Z","currency":"NOK","amountOre":50000,"blockedReason":null,"lines":[{"lineNo":1,"reference":null,"labelConflict":false,"description":"x","priceOre":50000}]}'::jsonb),true,'a NOK receipt is structurally valid');
select is(komisio_private.valid_zettle_purchase('{"externalId":"0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f","occurredAt":"2026-09-10T10:00:00Z","currency":"USD","amountOre":50000,"blockedReason":null,"lines":[{"lineNo":1,"reference":null,"labelConflict":false,"description":"x","priceOre":50000}]}'::jsonb),false,'an unsupported currency is invalid unless held');
-- The seller reads the store currency without membership; anon cannot.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000382","role":"authenticated"}';
select is(store_currency(current_setting('test.tenant')::uuid),'NOK','a signed-in seller reads the currency');
set local role anon;
select throws_ok($$select store_currency(current_setting('test.tenant')::uuid)$$,'42501',null,'anon cannot');
select * from finish();
rollback;
