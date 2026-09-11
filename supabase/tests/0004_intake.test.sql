begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('50000000-0000-0000-0000-000000000001','owner@intake.test',now()),
 ('50000000-0000-0000-0000-000000000002','reader@intake.test',now()),
 ('50000000-0000-0000-0000-000000000003','staff@intake.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.a',create_tenant('Intake A','intake-a',gen_random_uuid())::text,true);
select set_config('test.b',create_tenant('Intake B','intake-b',gen_random_uuid())::text,true);
select set_config('test.seller',gen_random_uuid()::text,true);
select set_config('test.bag',gen_random_uuid()::text,true);
select lives_ok($$select register_seller(current_setting('test.a')::uuid,current_setting('test.seller')::uuid,' Seller ','SELLER@example.test','')$$,'register seller with normalized email');
select is((select email from sellers where id=current_setting('test.seller')::uuid),'seller@example.test','email normalized');
select lives_ok($$select register_seller(current_setting('test.a')::uuid,current_setting('test.seller')::uuid,'Seller','seller@example.test','')$$,'same request safely retries');
select is((select count(*) from sellers),1::bigint,'seller retry creates no duplicate');
select throws_like($$select register_seller(current_setting('test.a')::uuid,current_setting('test.seller')::uuid,'Different','seller@example.test','')$$,'%REQUEST_CONFLICT%','changed request cannot overwrite seller');
select throws_like($$select register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'No contact','','')$$,'%INVALID_INPUT%','contact required');
select throws_like($$select register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Bad email','invalid','')$$,'%INVALID_INPUT%','direct RPC validates email');
select lives_ok($$select receive_bag(current_setting('test.a')::uuid,current_setting('test.bag')::uuid,current_setting('test.seller')::uuid,'Blue bag')$$,'receive unpriced bag');
select lives_ok($$select receive_bag(current_setting('test.a')::uuid,current_setting('test.bag')::uuid,current_setting('test.seller')::uuid,'Blue bag')$$,'receipt retries safely');
select is((select count(*) from bag_receipts),1::bigint,'receipt retry creates no duplicate');
select is((select count(*) from access_events where action='bag.received'),1::bigint,'receipt audit emitted exactly once');
select throws_like($$select receive_bag(current_setting('test.a')::uuid,current_setting('test.bag')::uuid,current_setting('test.seller')::uuid,'Different')$$,'%REQUEST_CONFLICT%','receipt cannot be rewritten');
select throws_like($$select receive_bag(current_setting('test.b')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'')$$,'%SELLER_NOT_FOUND%','even multi-store owner cannot mix seller and bag tenants');
select throws_like($$select receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,repeat('a',501))$$,'%INVALID_INPUT%','note length enforced at database');
select throws_ok($$delete from bag_receipts$$,'42501',null,'custody cannot be deleted through API');
select throws_ok($$update sellers set name='overwrite'$$,'42501',null,'seller cannot be updated directly');
select throws_ok($$insert into bag_receipts(id,tenant_id,seller_id,created_by) values(gen_random_uuid(),current_setting('test.a')::uuid,current_setting('test.seller')::uuid,auth.uid())$$,'42501',null,'direct writes denied');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.a')::uuid,'50000000-0000-0000-0000-000000000002','readonly'),
 (current_setting('test.a')::uuid,'50000000-0000-0000-0000-000000000003','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from bag_receipts),1::bigint,'readonly can see custody records');
select throws_like($$select receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'')$$,'%FORBIDDEN%','readonly cannot receive');
select throws_like($$select register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller','','123')$$,'%FORBIDDEN%','readonly cannot register');
set local "request.jwt.claims"='{"sub":"50000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Staff bag')$$,'staff can receive');
select throws_like($$select register_seller(current_setting('test.b')::uuid,gen_random_uuid(),'Intruder','','123')$$,'%FORBIDDEN%','staff cannot write another store');
select throws_like($$select receive_bag(current_setting('test.a')::uuid,current_setting('test.bag')::uuid,current_setting('test.seller')::uuid,'Blue bag')$$,'%REQUEST_CONFLICT%','another actor cannot claim an existing operation');
reset role;
delete from tenant_members where user_id='50000000-0000-0000-0000-000000000003';
set local role authenticated;
select is((select count(*) from sellers),0::bigint,'removed staff cannot read sellers');
select is((select count(*) from bag_receipts),0::bigint,'removed staff cannot read bags');
select throws_like($$select receive_bag(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'')$$,'%FORBIDDEN%','removed staff cannot write');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'50000000-0000-0000-0000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from bag_receipts),0::bigint,'MFA challenge blocks custody reads');
select throws_like($$select receive_bag(current_setting('test.a')::uuid,current_setting('test.bag')::uuid,current_setting('test.seller')::uuid,'Blue bag')$$,'%AUTH_REQUIRED%','MFA challenge blocks even replay');
set local role anon;
select throws_ok($$select * from sellers$$,'42501',null,'anonymous cannot read seller contacts');
select throws_ok($$select receive_bag(null,null,null,'')$$,'42501',null,'anonymous cannot call receiving');
reset role;
select * from finish();
rollback;
