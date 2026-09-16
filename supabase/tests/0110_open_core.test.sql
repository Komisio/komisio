begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Open core (2026-09-16): nothing a store does is gated by a plan or a cap.
-- The plan states of the hosted subscription remain, but an ended trial or a
-- lapsed subscription changes nothing the store can do.
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000941','free-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000942','free-owner@example.test',now());
insert into auth.users(id,is_anonymous) values ('f0000000-0000-4000-8000-000000000943',true),('f0000000-0000-4000-8000-000000000944',true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select set_config('test.old',create_tenant('Older store','free-older',gen_random_uuid())::text,true);
reset role;
select komisio_private.enable_billing('f0000000-0000-4000-8000-000000000941');
set local role authenticated;
select set_config('test.tenant',create_tenant('Free store','free-core-test',gen_random_uuid())::text,true);
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','trial','a new hosted store starts in trial');
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set trial_ends_at=now()-interval '1 day' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
select is((komisio_private.expire_plans()->>'expired')::int,1,'one trial expired');
set local role authenticated;
select is(plan_status(current_setting('test.tenant')::uuid)->>'state','free','the state is free');
select is((plan_status(current_setting('test.tenant')::uuid)->>'writable')::boolean,true,'and the store is writable');
select is(plan_status(current_setting('test.tenant')::uuid) ? 'itemLimit',false,'there is no item cap');
-- Everything is open.
select lives_ok($$select store_shopify_connection(current_setting('test.tenant')::uuid,'komisio-test.myshopify.com','Komisio Test','SEK','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}'::jsonb,'read_orders',null)$$,'Shopify connects');
select lives_ok($$select create_chain(gen_random_uuid(),'Kedjan',array[current_setting('test.tenant')::uuid])$$,'a chain is created');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"vatModeStoreOwned":"store_full"}');
create function pg_temp.accept_many(n integer) returns integer language plpgsql as $$
declare i integer; p uuid; begin
 for i in 1..n loop
  p:=register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea',1000,'R'||i,true);
  perform accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',p,null,2500);
 end loop; return n; end $$;
select is(pg_temp.accept_many(101),101,'a hundred and one items are accepted without a cap');
-- Two print devices pair.
select set_config('test.printer',gen_random_uuid()::text,true);
select register_printer(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid,'Counter','tcp','192.168.1.49:9100','ZD420',203);
select set_config('test.pair',create_print_pairing_code(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000943","role":"authenticated","is_anonymous":true}';
select pair_print_device(current_setting('test.pair')::jsonb->>'code','Kassan','1.0.0');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select set_config('test.pair2',create_print_pairing_code(current_setting('test.tenant')::uuid,current_setting('test.printer')::uuid)::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000944","role":"authenticated","is_anonymous":true}';
select lives_ok($$select pair_print_device(current_setting('test.pair2')::jsonb->>'code','Lager','1.0.0')$$,'a second device pairs');
-- Read-only and closed, set by the host by hand, still hold.
reset role;
select set_config('komisio.plan_transition','engine',true);
update tenant_plans set state='read_only' where tenant_id=current_setting('test.tenant')::uuid;
select set_config('komisio.plan_transition','',true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000942","role":"authenticated"}';
select throws_like($$select pg_temp.accept_many(1)$$,'%PLAN_READ_ONLY%','a read-only store records nothing');
select * from finish();
rollback;
