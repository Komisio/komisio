begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7200000-0000-4000-8000-000000000001','account-staff@example.test',now(),null,null),
 ('f7200000-0000-4000-8000-000000000002',null,null,'46700007202',now()),
 ('f7200000-0000-4000-8000-000000000003',null,null,'46700007203',now()),
 ('f7200000-0000-4000-8000-000000000004','account-reader@example.test',now(),null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic offer recipient','synthetic-account-recipient',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f7200000-0000-4000-8000-000000000101',null,'Synthetic agreement 1','Original synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f7200000-0000-4000-8000-000000000004','readonly');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f7200000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7200000-0000-4000-8000-000000000002/f7200000-0000-4000-8000-000000000201.jpg');
select submit_external_item_request('f7200000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',100000,'SEK',array['f7200000-0000-4000-8000-000000000201']::uuid[],'SE');

set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000301',null,40000,100000,'f7200000-0000-4000-8000-000000000101');
select register_seller(:'tenant','f7200000-0000-4000-8000-000000000901','Existing email seller','account-reader@example.test','');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')->'account','null'::jsonb,'a new phone user has no invented seller account');
select throws_like($$select complete_external_item_offer('f7200000-0000-4000-8000-000000000501','f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000101',null,null)$$,'%ACCOUNT_REQUIRED%','first acceptance needs account and bank details');
select throws_like($$select complete_external_item_offer(gen_random_uuid(),'f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000101','{"name":"Phone seller","email":"contact@example.test"}','{"holder":"Phone seller","country":"DE","kind":"local","account":"123456789","routing":"8327"}')$$,'%INVALID_INPUT%','onboarding requires Swedish bank details');
select throws_like($$select complete_external_item_offer(gen_random_uuid(),'f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000102',null,null)$$,'%AGREEMENT_CHANGED%','cannot substitute another agreement');
select throws_ok($$insert into external_item_handover_links(id) values(gen_random_uuid())$$,'42501',null,'phone clients cannot bypass the completion command');
reset role;
insert into auth.mfa_factors(id,created_at,updated_at,user_id,status,factor_type,friendly_name) values(gen_random_uuid(),now(),now(),'f7200000-0000-4000-8000-000000000002','verified','totp','Synthetic onboarding MFA');
set local role authenticated;
select throws_like($$select read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')$$,'%PHONE_VERIFICATION_REQUIRED%','MFA downgrade blocks account reads');
reset role;
delete from auth.mfa_factors where user_id='f7200000-0000-4000-8000-000000000002';
set local role authenticated;
select is(complete_external_item_offer('f7200000-0000-4000-8000-000000000501','f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000101','{"name":"Phone seller","email":"account-reader@example.test"}','{"holder":"Phone seller","country":"SE","kind":"local","account":"123456789","routing":"8327"}'),'f7200000-0000-4000-8000-000000000501'::uuid,'first final consent creates the seller, bank and handover atomically');
select lives_ok($$select complete_external_item_offer('f7200000-0000-4000-8000-000000000501','f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000101','{"name":"Phone seller","email":"account-reader@example.test"}','{"holder":"Phone seller","country":"SE","kind":"local","account":"123456789","routing":"8327"}')$$,'exact replay succeeds');
select throws_like($$select complete_external_item_offer('f7200000-0000-4000-8000-000000000501','f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000101','{"name":"Changed","email":"account-reader@example.test"}','{"holder":"Phone seller","country":"SE","kind":"local","account":"123456789","routing":"8327"}')$$,'%REQUEST_CONFLICT%','replay cannot change identity details');
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{account,name}','Phone seller','owner reads the new account');
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,status}','open','QR announcement does not assert physical receipt');
select ok(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,reference}' ~ '^H-[1-9][0-9]*$','uses the ordinary H reference');
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,itemCount}','1','count is based on linked offers');
select read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{account,id}' as seller \gset
select read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,id}' as handover \gset
select is(read_external_item_offer('f7200000-0000-4000-8000-000000000401')->>'status','accepted','final consent also records the immutable yes');
select submit_external_item_request('f7200000-0000-4000-8000-000000000302',:'tenant','Lamp','','good','',null,'SEK',array['f7200000-0000-4000-8000-000000000201']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7200000-0000-4000-8000-000000000402','f7200000-0000-4000-8000-000000000302',null,20000,50000,'f7200000-0000-4000-8000-000000000101');
select publish_seller_agreement(:'tenant','f7200000-0000-4000-8000-000000000102','f7200000-0000-4000-8000-000000000101','Later terms','Later body','sv',true);
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7200000-0000-4000-8000-000000000502','f7200000-0000-4000-8000-000000000402','f7200000-0000-4000-8000-000000000101',null,null);
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000402')#>>'{handover,id}',:'handover','same-version items share one open handover');
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,itemCount}','2','group count includes both confirmed items');
select submit_external_item_request('f7200000-0000-4000-8000-000000000303',:'tenant','Later upload','','good','',null,'SEK',array['f7200000-0000-4000-8000-000000000201']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7200000-0000-4000-8000-000000000403','f7200000-0000-4000-8000-000000000303',null,30000,80000,'f7200000-0000-4000-8000-000000000102');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7200000-0000-4000-8000-000000000503','f7200000-0000-4000-8000-000000000403','f7200000-0000-4000-8000-000000000102',null,null);
select isnt(read_external_item_onboarding('f7200000-0000-4000-8000-000000000403')#>>'{handover,id}',:'handover','a later agreement requires a separate handover with its own evidence');
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,itemCount}','2','later terms cannot change an earlier handover group');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like($$select read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')$$,'%OFFER_NOT_FOUND%','other phone identities cannot read account or bank information');
select throws_like($$select complete_external_item_offer(gen_random_uuid(),'f7200000-0000-4000-8000-000000000401','f7200000-0000-4000-8000-000000000101',null,null)$$,'%OFFER_NOT_FOUND%','another phone user cannot claim an accepted offer');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(jsonb_array_length(my_seller_accounts()),1,'matching contact email does not hide or duplicate the existing email seller');
select is(my_seller_accounts()#>>'{0,sellerId}','f7200000-0000-4000-8000-000000000901','email account retains only its own original seller');
select throws_ok(format($$select seller_bank_details(%L,%L)$$,:'tenant',:'seller'),'42501',null,'verified contact email cannot read phone-owned bank details');
select throws_ok(format($$select my_handovers(%L,%L)$$,:'tenant',:'seller'),'42501',null,'verified contact email cannot access phone-owned handovers');
select throws_ok(format($$select receive_handover(%L,gen_random_uuid(),%L,'staff_receipt','')$$,:'tenant',:'handover'),'42501',null,'read-only staff cannot record central physical custody');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from sellers where tenant_id=:'tenant'),2::bigint,'central registration never merges the existing email seller');
select is((select count(*) from seller_bank_versions where tenant_id=:'tenant' and seller_id=:'seller'),1::bigint,'retry and second item do not duplicate bank versions');
select is((select count(*) from bag_receipts where tenant_id=:'tenant'),0::bigint,'account completion creates no physical custody');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'account completion creates no credit');
select lives_ok(format($$select receive_handover(%L,'f7200000-0000-4000-8000-000000000601',%L,'staff_receipt','')$$,:'tenant',:'handover'),'staff records physical receipt after later agreement publication');
select is((select agreement_version_id from bag_receipts where tenant_id=:'tenant'),'f7200000-0000-4000-8000-000000000101'::uuid,'physical receipt preserves the accepted frozen agreement');
select lives_ok(format($$select receive_handover(%L,'f7200000-0000-4000-8000-000000000601',%L,'staff_receipt','')$$,:'tenant',:'handover'),'staff receipt retries exactly once');
set local request.jwt.claims='{"sub":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(read_external_item_onboarding('f7200000-0000-4000-8000-000000000401')#>>'{handover,status}','received','owner sees actual receipt');
reset role;
select is((select count(*) from tenant_members where user_id='f7200000-0000-4000-8000-000000000002'),0::bigint,'onboarding creates no tenant membership');
select throws_like(format($$update sellers set external_owner_id=null where id=%L$$,:'seller'),'%IMMUTABLE%','explicit identity cannot be cleared to enable email matching');
select throws_like($$delete from external_item_handover_links$$,'%IMMUTABLE%','offer handover links are immutable');
select throws_like(format($$insert into items(id,tenant_id,seller_id) values(gen_random_uuid(),%L,%L)$$,:'tenant',:'seller'),'%GUARANTEED_INTAKE_REQUIRED%','central promises cannot enter ordinary percentage-based acceptance');
select * from finish();
rollback;
