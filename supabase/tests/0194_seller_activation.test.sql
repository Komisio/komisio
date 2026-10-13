begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('a1000000-0000-4000-8000-000000000001','activation-owner@example.test',now()),
 ('a1000000-0000-4000-8000-000000000002','activation-other@example.test',now()),
 ('a1000000-0000-4000-8000-000000000003','activation-unconfirmed@example.test',null);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Activation test','activation-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','activation@example.test','')::text,true);
select set_config('test.message',gen_random_uuid()::text,true);
select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,current_setting('test.seller')::uuid,'message','seller.welcome','v2','en','Activate account','Activation notice','none',null);
select throws_like($$select claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'other@example.test')$$,'%REQUEST_CONFLICT%','recipient is frozen before sending');
select is(claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'activation@example.test'),true,'one send is claimed');
select is(claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'activation@example.test'),false,'concurrent or replayed send cannot claim again');
select ok((select activation_claimed_at is not null from seller_communications where id=current_setting('test.message')::uuid),'claim survives an uncertain transport');
select is((select count(*) from tenant_members where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'no seller membership is created');
select lives_ok($$select record_communication_delivery(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'sent','supabase-auth')$$,'existing immutable delivery outcome is retained');
select is(claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'activation@example.test'),false,'decided send is not repeated');
select set_config('test.legacy',gen_random_uuid()::text,true);
select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid,current_setting('test.seller')::uuid,'message','seller.welcome','v1','en','Old welcome','Old notice','none',null);
select throws_like($$select claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.legacy')::uuid,'activation@example.test')$$,'%INVALID_INPUT%','historical welcome cannot create an account on replay');
select throws_like($$update seller_communications set activation_claimed_at=null where id=current_setting('test.message')::uuid$$,'%permission denied%','claim cannot be reset directly');
set local "request.jwt.claims"='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$select claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'activation@example.test')$$,'%FORBIDDEN%','another user cannot claim a send');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'a1000000-0000-4000-8000-000000000002','readonly');
set local role authenticated;
select throws_like($$select claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'activation@example.test')$$,'%FORBIDDEN%','read-only members cannot send');
set local "request.jwt.claims"='{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like($$select claim_seller_activation(current_setting('test.tenant')::uuid,current_setting('test.message')::uuid,'activation@example.test')$$,'%AUTH_REQUIRED%','unconfirmed identity cannot claim');
select * from finish();
rollback;
