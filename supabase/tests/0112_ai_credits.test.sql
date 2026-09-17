begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000971','credits-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000972','credits-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000973','credits-billing@example.test',now());
-- The host switches credits on for this deployment (self-hosted keeps them off).
insert into public.platform_hosts(user_id) values('f0000000-0000-4000-8000-000000000971');
select komisio_private.register_billing_actor('f0000000-0000-4000-8000-000000000973');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000971","role":"authenticated"}';
select is((set_ai_platform_settings('{"enabled":true,"monthlyCapOre":300,"includedOre":120,"packOre":10000,"reserveOre":50,"reserveBatchOre":200}')->>'enabled')::boolean,true,'the host enables credits with a small cap for the test');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000972","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Credit store','credit-store',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other credit store','credit-other',gen_random_uuid())::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"assistanceEnabled":true}');
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@credits.test','')::text,true);
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,'[{"id":"a0000000-0000-4000-8000-000000000001","kind":"observation","reference":"fixture","observation":"blue jacket"}]'::jsonb);
select is((ai_credits(current_setting('test.tenant')::uuid)->>'includedLeftOre')::int,120,'a store starts with the included credits of the month');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'ownKey')::boolean,false,'no own key yet');
-- First call: reserved from the included credits, settled to the actual token cost.
select set_config('test.a1',gen_random_uuid()::text,true);
select is(reserve_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a1')::uuid,current_setting('test.session')::uuid,1,'model','reception-v4'),true,'the current single prompt reserves credits');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'includedLeftOre')::int,70,'the estimate is held');
select is((settle_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a1')::uuid,10000,1000)->>'costOre')::int,6,'settled to ceil(10000*420/1e6 + 1000*1700/1e6) = 6 öre');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'includedLeftOre')::int,114,'the reservation is corrected to the actual cost');
select is((settle_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a1')::uuid,10000,1000)->>'replayed')::boolean,true,'a second settlement is a replay');
-- Exhaustion: two more reservations use the rest; the next is refused.
reset role;
update public.reception_assistance_attempts set created_at=created_at-interval '1 minute';
set local role authenticated;
select set_config('test.a2',gen_random_uuid()::text,true);
select reserve_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a2')::uuid,current_setting('test.session')::uuid,1,'model','reception-v1');
reset role;
update public.reception_assistance_attempts set created_at=created_at-interval '1 minute';
set local role authenticated;
select set_config('test.a3',gen_random_uuid()::text,true);
select reserve_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a3')::uuid,current_setting('test.session')::uuid,1,'model','reception-v1');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'includedLeftOre')::int,14,'fourteen öre left');
reset role;
update public.reception_assistance_attempts set created_at=created_at-interval '1 minute';
set local role authenticated;
select throws_like($$select reserve_reception_assistance(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'model','reception-v1')$$,'%AI_CREDITS_EXHAUSTED%','no credits, no call');
select is((select count(*) from reception_assistance_attempts where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'a refused call leaves no attempt');
-- Purchased credits: recorded once by the billing actor, then usable.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000973","role":"authenticated"}';
select is((record_ai_credit_purchase('evt_1',current_setting('test.tenant')::uuid,10000,'{}')->>'matched')::boolean,true,'a purchase is recorded');
select is((record_ai_credit_purchase('evt_1',current_setting('test.tenant')::uuid,10000,'{}')->>'replayed')::boolean,true,'the same event is a replay');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000972","role":"authenticated"}';
select throws_ok($$select record_ai_credit_purchase('evt_2',current_setting('test.tenant')::uuid,10000,'{}')$$,'42501',null,'an owner cannot record a purchase');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'purchasedLeftOre')::int,10000,'one hundred credits bought');
select set_config('test.a4',gen_random_uuid()::text,true);
select reserve_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a4')::uuid,current_setting('test.session')::uuid,1,'model','reception-v1');
select is((select funded_by from ai_credit_events where reference='attempt:'||current_setting('test.a4') and kind='reserved'),'purchased','the call is funded by purchased credits');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'purchasedLeftOre')::int,9950,'and drawn from them');
-- The platform cap: included spend across stores stops at the cap, purchased credits do not count.
reset role;
select set_config('komisio.plan_transition','engine',true);
insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference) values(current_setting('test.other')::uuid,'reserved',-250,'included',komisio_private.usage_period(now()),'attempt:cap-fixture');
update public.reception_assistance_attempts set created_at=created_at-interval '1 minute';
set local role authenticated;
select set_config('test.a5',gen_random_uuid()::text,true);
select reserve_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a5')::uuid,current_setting('test.session')::uuid,1,'model','reception-v1');
select is((select funded_by from ai_credit_events where reference='attempt:'||current_setting('test.a5') and kind='reserved'),'purchased','under the cap, purchased credits still run');
select is((ai_credits(current_setting('test.tenant')::uuid)->>'capReached')::boolean,true,'the platform cap is reported');
-- A store on its own key is never metered.
select is(store_ai_connection(current_setting('test.tenant')::uuid,'openai','gpt-test','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb)->>'model','gpt-test','an own key connects');
select is(ai_connection_cipher(current_setting('test.tenant')::uuid)->>'model','gpt-test','staff read the sealed box for the run');
reset role;
update public.reception_assistance_attempts set created_at=created_at-interval '1 minute';
set local role authenticated;
select set_config('test.a6',gen_random_uuid()::text,true);
select reserve_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a6')::uuid,current_setting('test.session')::uuid,1,'model','reception-v1');
select is((select count(*) from ai_credit_events where reference='attempt:'||current_setting('test.a6')),0::bigint,'no credits move on an own key');
select is((settle_reception_assistance(current_setting('test.tenant')::uuid,current_setting('test.a6')::uuid,5000,500)->>'metered')::boolean,false,'settlement is a no-op');
select remove_ai_connection(current_setting('test.tenant')::uuid);
select is((ai_credits(current_setting('test.tenant')::uuid)->>'ownKey')::boolean,false,'the key is removed');
-- Nothing is gated any more: Shopify, chains and devices are open to every store.
select lives_ok($$select store_shopify_connection(current_setting('test.other')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb,'read_orders',null)$$,'Shopify is open');
select lives_ok($$select create_chain(gen_random_uuid(),'Kedjan',array[current_setting('test.other')::uuid])$$,'chains are open');
select is(plan_status(current_setting('test.other')::uuid) ? 'tier',false,'no tier is reported');
-- Public pricing and the showcase.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000971","role":"authenticated"}';
select is(jsonb_array_length(set_store_showcase(current_setting('test.tenant')::uuid,'second hand-butik i Teststad')->'showcase'),1,'the host lists a store');
set local role anon;
select is((public_pricing()->>'includedOre')::int,120,'anyone reads the offer');
select is(public_pricing()->'stores'->0->>'label','second hand-butik i Teststad','with the listed store, anonymously');
select is((public_pricing()->'stores'->0->>'costOre')::int,10000,'and its purchases of the last thirty days');
select throws_ok($$select ai_credits(current_setting('test.tenant')::uuid)$$,'42501',null,'balances need a session');
select * from finish();
rollback;
