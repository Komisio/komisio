begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7800000-0000-4000-8000-000000000001','parcel-staff@example.test',now(),null,null),
 ('f7800000-0000-4000-8000-000000000002','f7800000-0000-4000-8000-000000000002@example.test',now(),'46700007802',now()),
 ('f7800000-0000-4000-8000-000000000003','f7800000-0000-4000-8000-000000000003@example.test',now(),'46700007803',now());
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

select set_config('request.headers',jsonb_build_object('x-komisio-shipping',repeat('7',64))::text,true);
select is(claim_central_parcel('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401','{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}',null,null,null,null,'sandbox')#>>'{parcel,serviceCode}','24','existing configuration still claims Return');
select finish_central_parcel('f7800000-0000-4000-8000-000000000601','{"bookingId":"legacy","returnId":"legacy-return","trackingId":"003700000000000001","qrPng":"data:image/png;base64,iVBORw0KGgo="}');
select throws_ok($$update komisio_private.central_shipping_runtime set service_code='11'$$,'42501',null,'seller cannot choose carrier service');
reset role;
update komisio_private.central_shipping_runtime set service_code='11';
select throws_ok($$update komisio_private.central_shipping_runtime set service_code='17'$$,'23514',null,'Home is not an enabled service');
set local role authenticated;
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{parcel,serviceCode}','24','service switch does not rewrite an old parcel');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{parcel,booking,returnId}','legacy-return','old QR code survives the switch');
select is(claim_central_parcel('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401','{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}',null,null,null,null,'sandbox')->>'dispatch','false','replaying old request never creates a Home Small shipment');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000602','f7800000-0000-4000-8000-000000000402',array['f7800000-0000-4000-8000-000000000402']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')#>>'{parcel,serviceCode}','11','new group freezes Home Small from server configuration');
reset role;
select throws_like($$update central_parcels set service_code='24' where id='f7800000-0000-4000-8000-000000000602'$$,'%IMMUTABLE%','claimed service cannot be edited');
update komisio_private.central_shipping_runtime set service_code='24';
set local role authenticated;
select is(read_central_parcel('f7800000-0000-4000-8000-000000000402')#>>'{parcel,serviceCode}','11','configuration rollback does not rewrite a Home Small attempt');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000602','f7800000-0000-4000-8000-000000000402',array['f7800000-0000-4000-8000-000000000402']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')->>'dispatch','false','uncertain Home Small attempt remains held without redispatch');
select finish_central_parcel('f7800000-0000-4000-8000-000000000602','{"bookingId":"home-booking","returnId":"RSAPN0100SYNTHETIC","trackingId":"003700000000000002","qrPng":"data:image/png;base64,iVBORw0KGgo="}');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000402')#>>'{parcel,booking,returnId}','RSAPN0100SYNTHETIC','Home Small label code uses the compatible mobile field');
select is((select count(*) from seller_ledger_entries),0::bigint,'service selection has no balance effects');
select is((select count(*) from external_item_guarantees),0::bigint,'booking does not establish physical receipt');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select read_central_parcel('f7800000-0000-4000-8000-000000000402')$$,'42501',null,'Home Small codes remain private to their owner');
select is((select count(*) from central_parcels),0::bigint,'RLS isolates both services');
select * from finish(); rollback;
