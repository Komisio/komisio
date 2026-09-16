begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000941','free-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000942','free-owner@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select set_config('test.old',create_tenant('Older store','free-older',gen_random_uuid())::text,true);
select is(plan_status(current_setting('test.old')::uuid)->>'tier','plus','without billing every store is plus');
reset role;
select komisio_private.enable_billing('f0000000-0000-4000-8000-000000000941');
set local role authenticated;
select set_config('test.tenant',create_tenant('Free store','free-core-test',gen_random_uuid())::text,true);
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','trial','a new store starts a Plus trial');
select is(plan_status(current_setting('test.tenant')::uuid)->>'tier','plus','trial is plus');
select is(plan_status(current_setting('test.old')::uuid)->>'tier','plus','a store older than billing stays plus');
-- The trial ends: the store continues free, writable, with the cap.
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set trial_ends_at=now()-interval '1 day' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
select is((komisio_private.expire_plans()->>'expired')::int,1,'one trial expired');
set local role authenticated;
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','free','the store is on the free core');
select is((plan_status(current_setting('test.tenant')::uuid)->>'writable')::boolean,true,'and still writable');
select is((plan_status(current_setting('test.tenant')::uuid)->>'itemLimit')::int,100,'with the monthly item cap');
select is((plan_status(current_setting('test.tenant')::uuid)->>'deviceLimit')::int,1,'and one print device');
-- Plus features refuse.
select throws_like($$select store_shopify_connection(current_setting('test.tenant')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb,'read_orders',null)$$,'%PLAN_PLUS_REQUIRED%','Shopify needs Plus');
select throws_like($$select create_chain(gen_random_uuid(),'Kedjan',array[current_setting('test.tenant')::uuid])$$,'%PLAN_PLUS_REQUIRED%','chains need Plus');
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@free.test',''))::text,true);
select throws_like($$select reserve_reception_assistance(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,1,'model','prompt')$$,'%PLAN_PLUS_REQUIRED%','the assistant needs Plus');
-- The core keeps working: purchases and acceptance up to the cap.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"vatModeStoreOwned":"store_full"}');
create function pg_temp.accept_many(n integer) returns integer language plpgsql as $$
declare i integer; p uuid; begin
 for i in 1..n loop
  p:=register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea',1000,'R'||i,true);
  perform accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',p,null,2500);
 end loop; return n; end $$;
select is(pg_temp.accept_many(100),100,'one hundred items accepted in the free core');
select is((plan_status(current_setting('test.tenant')::uuid)->>'itemsThisMonth')::int,100,'usage counted');
select throws_like($$select pg_temp.accept_many(1)$$,'%PLAN_LIMIT_ITEMS%','the hundred and first is refused');
select is((select count(*) from items where tenant_id=current_setting('test.tenant')::uuid),100::bigint,'nothing recorded past the cap');
-- Plus lifts everything.
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set state='active',provider='manual',active_until=null where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
set local role authenticated;
select is(plan_status(current_setting('test.tenant')::uuid)->>'tier','plus','active is plus');
select is(plan_status(current_setting('test.tenant')::uuid)->'itemLimit','null'::jsonb,'no cap on Plus');
select is(pg_temp.accept_many(1),1,'the next item is accepted on Plus');
select lives_ok($$select store_shopify_connection(current_setting('test.tenant')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb,'read_orders',null)$$,'Shopify connects on Plus');
-- A cancelled subscription drops to free, not read-only.
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set state='past_due',grace_ends_at=now()-interval '1 day' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
select komisio_private.expire_plans();
set local role authenticated;
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','free','lapsed grace drops to free');
select is((plan_status(current_setting('test.tenant')::uuid)->>'writable')::boolean,true,'free stays writable');
select * from finish();
rollback;
