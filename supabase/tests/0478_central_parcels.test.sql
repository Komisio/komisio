begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7800000-0000-4000-8000-000000000001','parcel-staff@example.test',now(),null,null),
 ('f7800000-0000-4000-8000-000000000002',null,null,'46700007802',now()),
 ('f7800000-0000-4000-8000-000000000003',null,null,'46700007803',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic parcel recipient','synthetic-parcel-recipient',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f7800000-0000-4000-8000-000000000101',null,'Synthetic terms','Synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into komisio_private.central_shipping_runtime(singleton,key_hash,tenant_id,environment,recipient)
 values(true,encode(sha256(convert_to(repeat('7',64),'UTF8')),'hex'),:'tenant','sandbox',
 '{"name":"Synthetic company","street":"Testgatan 1","postalCode":"12345","city":"Teststad","country":"SE","phone":"+46700000000","email":"parcel@example.test"}');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f7800000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7800000-0000-4000-8000-000000000002/f7800000-0000-4000-8000-000000000201.jpg');
select submit_external_item_request('f7800000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000201']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000302',:'tenant','Dress','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000201']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000301',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000302',null,30000,80000,'f7800000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7800000-0000-4000-8000-000000000501','f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000101','{"name":"Synthetic seller","email":"seller@example.test"}','{"holder":"Synthetic seller","country":"SE","kind":"local","account":"123456789","routing":"8327"}');
select complete_external_item_offer('f7800000-0000-4000-8000-000000000502','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000101',null,null);
select read_external_item_onboarding('f7800000-0000-4000-8000-000000000401')#>>'{handover,id}' as handover \gset
select isnt(read_external_item_onboarding('f7800000-0000-4000-8000-000000000402')#>>'{handover,id}',:'handover','new central items have independent physical receipt');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')->'parcel','null'::jsonb,'no parcel is fabricated before booking');
select throws_ok($$insert into central_parcels(id) values(gen_random_uuid())$$,'42501',null,'direct parcel writes denied');
select throws_ok($$select claim_central_parcel('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'sandbox')$$,'42501',null,'seller cannot dispatch without server capability');
select set_config('request.headers',jsonb_build_object('x-komisio-shipping',repeat('7',64))::text,true);
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401',jsonb_build_object('street',repeat('A',51),'postalCode','12345','city','Teststad'),1000,400,300,200,'sandbox')$$,'%INVALID_INPUT%','carrier street length enforced before dispatch');
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401',jsonb_build_object('street','Testvägen 2','postalCode','12345','city',repeat('A',36)),1000,400,300,200,'sandbox')$$,'%INVALID_INPUT%','carrier city length enforced before dispatch');
reset role;
update sellers set name=repeat('A',61) where external_owner_id='f7800000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'sandbox')$$,'%SHIPPING_CONTACT_UNSUPPORTED%','oversized profile is rejected without a carrier attempt');
select is((select count(*) from central_parcels),0::bigint,'invalid profile never claims a parcel');
reset role;
update sellers set name='Synthetic seller' where external_owner_id='f7800000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',20001,400,300,200,'sandbox')$$,'%INVALID_INPUT%','overweight parcel denied before booking');
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,1500,1000,1000,'sandbox')$$,'%INVALID_INPUT%','length and circumference limit enforced');
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'production')$$,'%SHIPPING_UNAVAILABLE%','environment mismatch fails closed');
select is(claim_central_parcel('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'sandbox')->>'dispatch','true','one dispatch is claimed');
select is(claim_central_parcel('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'sandbox')->>'dispatch','false','retry cannot dispatch again after an uncertain result');
select throws_like($$select claim_central_parcel('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401','{"street":"Changed 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'sandbox')$$,'%REQUEST_CONFLICT%','request identity cannot rewrite sender');
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',1000,400,300,200,'sandbox')$$,'%PARCEL_EXISTS%','another request cannot buy a second label for the item');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{parcel,status}','pending','dispatch without confirmation stays pending');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{parcel,sender,phone}','+46700007802','phone comes from verified identity');
select set_config('request.headers','{}',true);
select throws_ok($$select finish_central_parcel('f7800000-0000-4000-8000-000000000601',null)$$,'42501',null,'seller cannot forge provider confirmation');
select set_config('request.headers',jsonb_build_object('x-komisio-shipping',repeat('7',64))::text,true);
select lives_ok($$select finish_central_parcel('f7800000-0000-4000-8000-000000000601','{"bookingId":"synthetic-booking","returnId":"synthetic-return","trackingId":"003700000000000001","qrPng":"data:image/png;base64,iVBORw0KGgo="}')$$,'server saves validated provider evidence');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{parcel,status}','booked','provider confirmation is separate from custody');
select lives_ok($$select finish_central_parcel('f7800000-0000-4000-8000-000000000601','{"bookingId":"synthetic-booking","returnId":"synthetic-return","trackingId":"003700000000000001","qrPng":"data:image/png;base64,iVBORw0KGgo="}')$$,'same provider completion can replay');
select throws_like($$select finish_central_parcel('f7800000-0000-4000-8000-000000000601',null)$$,'%REQUEST_CONFLICT%','confirmation cannot be replaced by a failure');
select is(read_external_item_onboarding('f7800000-0000-4000-8000-000000000401')#>>'{handover,status}','open','booking never records receipt');
select is((select count(*) from external_item_guarantees where tenant_id=:'tenant'),0::bigint,'booking does not start 45-day clock');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select read_central_parcel('f7800000-0000-4000-8000-000000000401')$$,'42501',null,'another user cannot read parcel addresses or QR');
select is((select count(*) from central_parcels),0::bigint,'RLS hides other sellers parcels');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(format($$select receive_handover(%L,gen_random_uuid(),%L,'staff_receipt','')$$,:'tenant',:'handover'),'staff still confirms physical receipt');
select is((select count(*) from external_item_guarantees where tenant_id=:'tenant'),1::bigint,'receiving one package starts only its guarantee');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'shipping and receipt never credit or deduct seller money');
reset role;
select throws_like($$update central_parcels set weight_g=1 where id='f7800000-0000-4000-8000-000000000601'$$,'%IMMUTABLE%','frozen package measurements cannot be overwritten');
select * from finish();
rollback;
