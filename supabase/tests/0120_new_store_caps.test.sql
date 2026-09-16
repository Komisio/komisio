begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000901','new-caps-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000902','new-caps-owner@example.test',now());
insert into public.platform_hosts(user_id) values('f0000000-0000-4000-8000-000000000901');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000901","role":"authenticated"}';
-- Small numbers make the boundary observable; the host owns all five.
select is((set_ai_platform_settings('{"emailNewCap":1,"inviteNewCap":1,"emailTrustDays":7,"emailDailyCap":3,"inviteDailyCap":3}')->>'emailNewCap')::int,1,'the host sets the new-store message cap');
select is((ai_platform_settings()->>'inviteNewCap')::int,1,'and the new-store invitation cap');
select is((ai_platform_settings()->>'emailTrustDays')::int,7,'and how long a store counts as new');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000902","role":"authenticated"}';
select throws_ok($$select set_ai_platform_settings('{"emailNewCap":5000}')$$,'42501',null,'a store owner cannot raise its own cap');
select set_config('test.tenant',create_tenant('Fresh store','new-caps-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','seller@new-caps.test','')::text,true);

-- A store registered today lives under the new-store numbers.
select lives_ok($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'a fresh store sends its first message');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'%EMAIL_DAILY_CAP%','and is stopped at the new-store cap, far below the established one');
select is((select count(*) from seller_communications where tenant_id=current_setting('test.tenant')::uuid),1::bigint,'a refused message is never written');
select lives_ok($$select create_invitation(current_setting('test.tenant')::uuid,'colleague@new-caps.test','staff',repeat('a',64))$$,'a fresh store invites one colleague');
select throws_like($$select create_invitation(current_setting('test.tenant')::uuid,'second@new-caps.test','staff',repeat('b',64))$$,'%INVITE_DAILY_CAP%','and is stopped at the new-store invitation cap');

-- The same store, once it is no longer new, gets the established numbers.
reset role;
update public.tenants set created_at=now()-interval '8 days' where id=current_setting('test.tenant')::uuid;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000902","role":"authenticated"}';
select lives_ok($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'an established store sends beyond the new-store cap');
select lives_ok($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'and keeps sending up to the established one');
select throws_like($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'%EMAIL_DAILY_CAP%','and is stopped there');
select lives_ok($$select create_invitation(current_setting('test.tenant')::uuid,'third@new-caps.test','staff',repeat('c',64))$$,'and invites beyond the new-store invitation cap');

-- Turning the distinction off restores one number for every store.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000901","role":"authenticated"}';
select set_ai_platform_settings('{"emailTrustDays":0}');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000902","role":"authenticated"}';
select set_config('test.fresh',create_tenant('Another fresh store','new-caps-second',gen_random_uuid())::text,true);
select set_config('test.freshseller',register_seller(current_setting('test.fresh')::uuid,gen_random_uuid(),'Seller','seller@second.test','')::text,true);
select lives_ok($$select queue_seller_communication(current_setting('test.fresh')::uuid,gen_random_uuid(),current_setting('test.freshseller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'with no trust window a brand new store starts on the established cap');
select lives_ok($$select queue_seller_communication(current_setting('test.fresh')::uuid,gen_random_uuid(),current_setting('test.freshseller')::uuid,'message','message','v1','sv','Hej','Text','none',null)$$,'and may pass the new-store number at once');
select * from finish();
rollback;
