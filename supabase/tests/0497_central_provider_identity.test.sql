begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('f9700000-0000-4000-8000-000000000001','',now(),'46700009701',now(),'{}','{}'),
 ('f9700000-0000-4000-8000-000000000002',null,null,null,null,'{}','{"email":"fake@example.test","email_verified":true}'),
 ('f9700000-0000-4000-8000-000000000003',null,null,null,null,'{}','{}');
insert into auth.identities(id,user_id,provider_id,provider,identity_data) values
 (gen_random_uuid(),'f9700000-0000-4000-8000-000000000001','central-apple','apple','{"sub":"central-apple","email":"central-relay@example.test","email_verified":true}'),
 (gen_random_uuid(),'f9700000-0000-4000-8000-000000000003','unverified-apple','apple','{"sub":"unverified-apple","email":"unverified@example.test","email_verified":false}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f9700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select ok(external_identity_verified(),'verified Apple identity authorizes its own central account with empty primary email');
select lives_ok($$select reserve_external_item_photo('f9700000-0000-4000-8000-000000000101',repeat('a',64),100)$$,'linked Apple account reserves its own photo');
select is((select count(*) from tenant_members),0::bigint,'no store membership is created');
select throws_ok($$select komisio_private.central_identity_email('f9700000-0000-4000-8000-000000000001')$$,'42501',null,'provider email helper is not exposed');
select set_config('request.jwt.claims','{"sub":"f9700000-0000-4000-8000-000000000002","role":"authenticated","email_verified":true}',true);
select is(external_identity_verified(),false,'user metadata and JWT claims are not verified provider evidence');
select is((select count(*) from external_item_photos),0::bigint,'another owner cannot read Apple account photos');
select set_config('request.jwt.claims','{"sub":"f9700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(external_identity_verified(),false,'unverified Apple email is denied');
reset role;
update auth.users set raw_app_meta_data='{"komisio_password_recovery_pending":true}' where id='f9700000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f9700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(external_identity_verified(),false,'recovery guard remains enforced for linked Apple');
reset role;
update auth.users set raw_app_meta_data='{}',is_anonymous=true where id='f9700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(external_identity_verified(),false,'anonymous users cannot qualify through provider metadata');
reset role;
select * from finish();
rollback;
