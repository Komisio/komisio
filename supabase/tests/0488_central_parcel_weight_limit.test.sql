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
reset role;
insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash;
update komisio_private.central_shipping_runtime set service_code='11';
set local role authenticated;
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('a',64),'x-komisio-shipping',repeat('7',64))::text,true);
select begin_external_photo_analysis('f7800000-0000-4000-8000-000000000211',:'tenant',array['f7800000-0000-4000-8000-000000000201']::uuid[],'synthetic','sv','central-photo-v2-weight');
select complete_external_photo_analysis('f7800000-0000-4000-8000-000000000211','{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":400}',100,10);
-- Mobile submission copies the AI image into an independently retained upload.
select reserve_external_item_photo('f7800000-0000-4000-8000-000000000202',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7800000-0000-4000-8000-000000000002/f7800000-0000-4000-8000-000000000202.jpg');
select verify_external_item_photo('f7800000-0000-4000-8000-000000000202',repeat('a',64),100);
select submit_external_item_request('f7800000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000302',:'tenant','Dress','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000301',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000302',null,30000,80000,'f7800000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7800000-0000-4000-8000-000000000501','f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000101','{"name":"Synthetic seller","email":"seller@example.test"}','{"holder":"Synthetic seller","country":"SE","kind":"local","account":"123456789","routing":"8327"}');
select complete_external_item_offer('f7800000-0000-4000-8000-000000000502','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000101',null,null);

select submit_external_item_request('f7800000-0000-4000-8000-000000000303',:'tenant','Dress 3','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000304',:'tenant','Dress 4','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000305',:'tenant','Dress 5','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000306',:'tenant','Dress 6','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000307',:'tenant','Dress 7','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000308',:'tenant','Dress 8','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000309',:'tenant','Dress 9','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
select submit_external_item_request('f7800000-0000-4000-8000-000000000310',:'tenant','Dress 10','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000202']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000303',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000304',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000405','f7800000-0000-4000-8000-000000000305',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000406','f7800000-0000-4000-8000-000000000306',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000407','f7800000-0000-4000-8000-000000000307',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000408','f7800000-0000-4000-8000-000000000308',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000409','f7800000-0000-4000-8000-000000000309',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000410','f7800000-0000-4000-8000-000000000310',null,40000,100000,'f7800000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7800000-0000-4000-8000-000000000503','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000504','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000505','f7800000-0000-4000-8000-000000000405','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000506','f7800000-0000-4000-8000-000000000406','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000507','f7800000-0000-4000-8000-000000000407','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000508','f7800000-0000-4000-8000-000000000408','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000509','f7800000-0000-4000-8000-000000000409','f7800000-0000-4000-8000-000000000101',null,null);
select complete_external_item_offer('f7800000-0000-4000-8000-000000000510','f7800000-0000-4000-8000-000000000410','f7800000-0000-4000-8000-000000000101',null,null);
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')->>'selectionWeightLimitG','2000','server advertises selection limit');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{eligibleItems,0,selectionWeightG}','400','selection uses frozen photo estimate');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000405','f7800000-0000-4000-8000-000000000406']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%PARCEL_WEIGHT_LIMIT%','six 400 g items cannot dispatch');
select is((select count(*) from central_parcels),0::bigint,'oversized group leaves no partial claim');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000405']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')#>>'{parcel,estimatedWeightG}','3000','five 400 g items include packaging allowance');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000405']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')->>'dispatch','false','same package is not dispatched twice');
select finish_central_parcel('f7800000-0000-4000-8000-000000000601','{"bookingId":"booking-601","returnId":"RSAPN0100TEST601","trackingId":"003700000000000601","qrPng":"data:image/png;base64,iVBORw0KGgo="}');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000602','f7800000-0000-4000-8000-000000000406',array['f7800000-0000-4000-8000-000000000406','f7800000-0000-4000-8000-000000000407','f7800000-0000-4000-8000-000000000408','f7800000-0000-4000-8000-000000000409','f7800000-0000-4000-8000-000000000410']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')#>>'{parcel,estimatedWeightG}','3000','five 400 g items include packaging allowance');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000602','f7800000-0000-4000-8000-000000000406',array['f7800000-0000-4000-8000-000000000406','f7800000-0000-4000-8000-000000000407','f7800000-0000-4000-8000-000000000408','f7800000-0000-4000-8000-000000000409','f7800000-0000-4000-8000-000000000410']::uuid[],'{"firstName":"Synthetic","lastName":"sender","phone":"+46700007802","street":"Testgatan 2","postalCode":"12345","city":"Teststad"}','sandbox')->>'dispatch','false','same package is not dispatched twice');
select finish_central_parcel('f7800000-0000-4000-8000-000000000602','{"bookingId":"booking-602","returnId":"RSAPN0100TEST602","trackingId":"003700000000000602","qrPng":"data:image/png;base64,iVBORw0KGgo="}');
select isnt(read_central_parcel('f7800000-0000-4000-8000-000000000401')#>>'{parcel,booking,returnId}',read_central_parcel('f7800000-0000-4000-8000-000000000406')#>>'{parcel,booking,returnId}','two selections have separate shipping codes');
select is((select count(*) from central_parcels),2::bigint,'ten items require exactly two parcels');
select is((select count(*) from external_item_guarantees),0::bigint,'no receipt or guarantee created');
select * from finish(); rollback;
