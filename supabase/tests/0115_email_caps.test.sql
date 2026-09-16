begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000991','caps-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000992','caps-owner@example.test',now());
insert into public.platform_hosts(user_id) values('f0000000-0000-4000-8000-000000000991');
-- A small cap makes the boundary observable; the host owns both numbers.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000991","role":"authenticated"}';
select is((set_ai_platform_settings('{"emailDailyCap":2,"inviteDailyCap":1}')->>'emailDailyCap')::int,2,'the host sets the daily message cap');
select is((ai_platform_settings()->>'inviteDailyCap')::int,1,'and the daily invitation cap');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000992","role":"authenticated"}';
select throws_ok($$select set_ai_platform_settings('{"emailDailyCap":5000}')$$,'42501',null,'a store owner cannot raise its own cap');
select set_config('test.tenant',create_tenant('Cap store','caps-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','seller@caps.test','')::text,true);
-- Seller messages: two are queued, the third is refused, and nothing is written.
select set_config('test.m1',gen_random_uuid()::text,true);
select set_config('test.m2',gen_random_uuid()::text,true);
select is(queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null),current_setting('test.m1')::uuid,'the first message is queued');
select is(queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.m2')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null),current_setting('test.m2')::uuid,'the second reaches the cap');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'%EMAIL_DAILY_CAP%','the third is refused');
select is((select count(*) from seller_communications where tenant_id=current_setting('test.tenant')::uuid),2::bigint,'a refused message is never written');
-- A retry of a message that already exists is not a new message.
select is(queue_seller_communication(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null),current_setting('test.m1')::uuid,'a retry of a queued message still returns it');
-- One store's messages never consume another store's cap, and the window rolls:
-- yesterday's messages are history, so this store may still send today.
select set_config('test.other',create_tenant('Other cap store','caps-other',gen_random_uuid())::text,true);
select set_config('test.otherseller',register_seller(current_setting('test.other')::uuid,gen_random_uuid(),'Seller','seller@other-caps.test','')::text,true);
reset role;
insert into public.seller_communications(id,tenant_id,seller_id,kind,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by,queued_at)
select gen_random_uuid(),current_setting('test.other')::uuid,current_setting('test.otherseller')::uuid,'message','message','v1','sv','seller@other-caps.test','Igar','Text','none',null,'f0000000-0000-4000-8000-000000000992',now()-interval '25 hours'
from generate_series(1,2);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000992","role":"authenticated"}';
select lives_ok($$select queue_seller_communication(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.otherseller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'yesterday no longer counts against today');
-- Invitations follow the same shape.
select lives_ok($$select create_invitation(current_setting('test.tenant')::uuid,'colleague@caps.test','staff',repeat('a',64))$$,'the first invitation is created');
select throws_like($$select create_invitation(current_setting('test.tenant')::uuid,'second@caps.test','staff',repeat('b',64))$$,'%INVITE_DAILY_CAP%','the second is refused');
select is((select count(*) from tenant_invitations where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'a refused invitation is never written');
select * from finish();
rollback;
