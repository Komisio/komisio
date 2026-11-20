begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('fa040000-0000-4000-8000-000000000001','admin504@example.test',now()),
 ('fa040000-0000-4000-8000-000000000002',null,null),
 ('fa040000-0000-4000-8000-000000000003',null,null);
insert into auth.identities(id,user_id,provider_id,provider,identity_data) values
 (gen_random_uuid(),'fa040000-0000-4000-8000-000000000002','apple-504','apple','{"sub":"apple-504","email":"relay504@example.test","email_verified":true}'),
 (gen_random_uuid(),'fa040000-0000-4000-8000-000000000003','google-504','google','{"sub":"google-504","email":"other504@example.test","email_verified":true}');
set local role authenticated;
set local request.jwt.claims='{"sub":"fa040000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Central sample','central-provider-504',gen_random_uuid()) as central \gset
select create_tenant('Independent sample','ordinary-provider-504',gen_random_uuid()) as shop \gset
select publish_seller_agreement(:'central',gen_random_uuid(),null,'Terms','Synthetic terms','sv',true) as agreement \gset
select register_seller(:'shop',gen_random_uuid(),'Sample seller','relay504@example.test','') as ordinary \gset
reset role;
update public.platform_settings set central_app_tenant_id=:'central' where only_row;
set local role authenticated;
set local request.jwt.claims='{"sub":"fa040000-0000-4000-8000-000000000002","role":"authenticated"}';
select save_central_intake_profile(gen_random_uuid(),:'central',:'agreement',-1,'{"street":"Test 1","postalCode":"12345","city":"Test"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000504"}',true);
select read_central_intake_profile()#>>'{account,sellerId}' as seller \gset
select is(my_seller_payouts_page(:'central',:'seller')->>'sellerId',:'seller','verified Apple owner can read own balance without a second email');
select lives_ok(format($$select save_central_payout_preference(%L,%L,gen_random_uuid(),null,'{"method":"swish","phone":"+46700000504"}')$$,:'central',:'seller'),'same owner may confirm a Swish number');
select is(read_central_intake_profile()#>>'{payoutPreference,phone}','+46700000504','confirmed Swish number is visible to owner');
select throws_ok(format('select my_seller_payouts_page(%L,%L)',:'shop',:'ordinary'),'42501',null,'matching provider email cannot open store money');
set local request.jwt.claims='{"sub":"fa040000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(format('select my_seller_payouts_page(%L,%L)',:'central',:'seller'),'42501',null,'a different verified identity cannot open this balance');
reset role;
update auth.users set raw_app_meta_data='{"komisio_password_recovery_pending":true}' where id='fa040000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"fa040000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(format('select my_seller_payouts_page(%L,%L)',:'central',:'seller'),'42501',null,'pending recovery cannot read financial data');
select * from finish(); rollback;
