begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(komisio_private.operation_risk('importSellers'),'low','seller imports are low risk');
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000001001','import-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000001002','import-readonly@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Import test','import-test',gen_random_uuid())::text,true);
select set_config('test.existing',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Anna Andersson','anna@import.test','')::text,true);
select set_config('test.op',gen_random_uuid()::text,true);
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'importSellers',jsonb_build_object('source','old.csv','rows',jsonb_build_array(jsonb_build_object('name','','email','x@import.test','phone',''))),'import-wizard',now()+interval '1 day')$$,'%INVALID_INPUT%','a row without a name is refused');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'importSellers',jsonb_build_object('source','old.csv','rows',jsonb_build_array(jsonb_build_object('name','Bo','email','','phone',''))),'import-wizard',now()+interval '1 day')$$,'%INVALID_INPUT%','a row without contact is refused');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'importSellers',jsonb_build_object('source','old.csv','rows',jsonb_build_array(jsonb_build_object('name','Bo','email','not-an-email','phone',''))),'import-wizard',now()+interval '1 day')$$,'%INVALID_INPUT%','a bad e-mail is refused');
select throws_like($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'importSellers',jsonb_build_object('source','old.csv','rows','[]'::jsonb),'import-wizard',now()+interval '1 day')$$,'%INVALID_INPUT%','an empty import is refused');
select is(propose_operation(current_setting('test.tenant')::uuid,current_setting('test.op')::uuid,'importSellers',jsonb_build_object('source','old.csv','rows',jsonb_build_array(
  jsonb_build_object('name','Bo Berg','email','bo@import.test','phone',''),
  jsonb_build_object('name','Cia Carlsson','email','','phone','0701234567'),
  jsonb_build_object('name','Anna A','email','ANNA@import.test','phone',''))),'import-wizard',now()+interval '1 day'),current_setting('test.op')::uuid,'import staged');
select is((select count(*) from sellers where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'nothing registered by staging');
select is((select detail->>'existing' from access_events where tenant_id=current_setting('test.tenant')::uuid and action='operation.proposed' and target_id=current_setting('test.op')::uuid),'1','preflight counts the known e-mail');
select is((select risk_level from pending_operations where id=current_setting('test.op')::uuid),'low','stored as low risk');
select set_config('test.decision',gen_random_uuid()::text,true);
select lives_ok($$select decide_operation(current_setting('test.tenant')::uuid,current_setting('test.decision')::uuid,current_setting('test.op')::uuid,'approved','Checked the preview')$$,'the person who staged the import approves it');
select is((select outcome from operation_decisions where id=current_setting('test.decision')::uuid),'executed','executed');
select is((select count(*) from sellers where tenant_id=current_setting('test.tenant')::uuid),3::bigint,'two new sellers, the known e-mail skipped');
select is((select email from sellers where tenant_id=current_setting('test.tenant')::uuid and name='Bo Berg'),'bo@import.test','e-mail stored lower-cased');
select is((select phone from sellers where tenant_id=current_setting('test.tenant')::uuid and name='Cia Carlsson'),'0701234567','phone-only seller registered');
select is((select count(*) from sellers where tenant_id=current_setting('test.tenant')::uuid and lower(email)='anna@import.test'),1::bigint,'the existing seller is not duplicated');
select is((select detail->>'created' from access_events where tenant_id=current_setting('test.tenant')::uuid and action='sellers.imported'),'2','import recorded with counts');
select is((select detail->>'skipped' from access_events where tenant_id=current_setting('test.tenant')::uuid and action='sellers.imported'),'1','skipped counted');
select is((select count(*) from operation_queue_filtered_page(current_setting('test.tenant')::uuid,'all',null,null,'importSellers')),1::bigint,'queue filters by the new kind');
reset role;
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000001002','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000001002","role":"authenticated"}';
select throws_ok($$select propose_operation(current_setting('test.tenant')::uuid,gen_random_uuid(),'importSellers',jsonb_build_object('source','old.csv','rows',jsonb_build_array(jsonb_build_object('name','Dan','email','dan@import.test','phone',''))),'import-wizard',now()+interval '1 day')$$,'42501',null,'read-only members cannot stage an import');
select * from finish();
