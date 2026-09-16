begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000201','comm-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000202','comm-reader@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000201","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Comm test','comm-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','Seller@Comm.test','')::text,true);
select set_config('test.phone',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Phone seller','','0700000000')::text,true);
select set_config('test.other',create_tenant('Other comm','comm-other',gen_random_uuid())::text,true);
select set_config('test.foreign',register_seller(current_setting('test.other')::uuid,gen_random_uuid(),'Foreign seller','foreign@comm.test','')::text,true);
select set_config('test.c1',gen_random_uuid()::text,true);
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.phone')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'%SELLER_EMAIL_MISSING%','a seller without e-mail cannot be mailed');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.foreign')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'%SELLER_NOT_FOUND%','another tenant seller rejected');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','pt','Hej','Text','none',null)$$,'%INVALID_INPUT%','unknown locale rejected');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','','Text','none',null)$$,'%INVALID_INPUT%','empty subject rejected');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'payout_paid','payout_paid','v1','sv','Utbetalt','Text','payout',gen_random_uuid())$$,'%REFERENCE_NOT_FOUND%','a reference must exist and belong to the seller');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',gen_random_uuid())$$,'%INVALID_INPUT%','a free message carries no reference');
select is(queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv',' Hej ','  Text  ','none',null),current_setting('test.c1')::uuid,'message queued');
select is(queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null),current_setting('test.c1')::uuid,'replay with trimmed text');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Other','none',null)$$,'%REQUEST_CONFLICT%','changed replay rejected');
select is((select status||'|'||recipient||'|'||subject from seller_communications where id=current_setting('test.c1')::uuid),'queued|seller@comm.test|Hej','queued with the seller address lowercased');
-- Delivery outcome is recorded once.
select throws_like($$select record_communication_delivery(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,'delivered')$$,'%INVALID_INPUT%','unknown status rejected');
select throws_like($$select record_communication_delivery(current_setting('test.tenant')::uuid,gen_random_uuid(),'sent')$$,'%COMMUNICATION_NOT_FOUND%','unknown message rejected');
select is(record_communication_delivery(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,'sent','re_123'),current_setting('test.c1')::uuid,'sent recorded');
select is(record_communication_delivery(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,'sent','re_123'),current_setting('test.c1')::uuid,'same outcome replays');
select throws_like($$select record_communication_delivery(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,'failed')$$,'%COMMUNICATION_DECIDED%','a second outcome is refused');
select is((select status||'|'||provider_message_id||'|'||(delivered_at is not null)::text from seller_communications where id=current_setting('test.c1')::uuid),'sent|re_123|true','outcome stored');
-- A statement reference must belong to the seller.
select set_config('test.stmt',issue_statement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'2026-08-01','2026-09-01')::text,true);
select set_config('test.c2',gen_random_uuid()::text,true);
select lives_ok($$select queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.c2')::uuid,current_setting('test.seller')::uuid,'statement_issued','statement_issued','v1','en','Statement 1','Body','statement',current_setting('test.stmt')::uuid)$$,'statement message queued');
select record_communication_delivery(current_setting('test.tenant')::uuid,current_setting('test.c2')::uuid,'restricted');
select is((select status from seller_communications where id=current_setting('test.c2')::uuid),'restricted','pilot allowlist restriction recorded as an outcome');
select throws_ok($$update seller_communications set body='x'$$,'42501',null,'direct update denied');
reset role;
select throws_like($$update seller_communications set body='x' where id=current_setting('test.c1')::uuid$$,'%IMMUTABLE_COMMUNICATION%','privileged body change refused');
select throws_like($$delete from seller_communications where id=current_setting('test.c1')::uuid$$,'%IMMUTABLE_COMMUNICATION%','delete refused');
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000202','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000202","role":"authenticated"}';
select is((select count(*) from seller_communications),2::bigint,'readonly reads the log');
select throws_ok($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'42501',null,'readonly cannot queue');
select * from finish();
rollback;
