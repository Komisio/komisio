begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at,raw_app_meta_data) values
 ('f9100000-0000-4000-8000-000000000001','central-email@example.test',now(),null,null,'{}'),
 ('f9100000-0000-4000-8000-000000000002','central-unverified@example.test',null,null,null,'{}'),
 ('f9100000-0000-4000-8000-000000000003',null,null,'46700009103',now(),'{}'),
 ('f9100000-0000-4000-8000-000000000004','central-recovery@example.test',now(),null,null,'{"komisio_password_recovery_pending":true}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(external_identity_verified(),'verified email without phone authorizes central identity');
select lives_ok($$select reserve_external_item_photo('f9100000-0000-4000-8000-000000000101',repeat('a',64),100)$$,'email identity reserves its own photo');
select is((select count(*) from tenant_members),0::bigint,'central identity grants no membership');
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000002","role":"authenticated","email_confirmed_at":"2026-01-01"}',true);
select is(external_identity_verified(),false,'unverified email cannot spoof verification in JWT claims');
select throws_ok($$select reserve_external_item_photo(gen_random_uuid(),repeat('a',64),100)$$,'42501','AUTH_REQUIRED','unverified email cannot upload');
select is((select count(*) from external_item_photos),0::bigint,'another identity cannot read the photo');
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(external_identity_verified(),false,'phone-only identity no longer authorizes central access');
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is(external_identity_verified(),false,'pending password recovery remains blocked');
reset role;
select is(to_regprocedure('public.external_phone_verified()'),null::regprocedure,'retired phone predicate is absent');
select is(to_regprocedure('komisio_private.external_phone_owner()'),null::regprocedure,'retired phone owner helper is absent');
select * from finish();
rollback;
