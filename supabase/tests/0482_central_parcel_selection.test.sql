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
-- A received item and another seller's accepted item are never selectable.
select submit_external_item_request('f7800000-0000-4000-8000-000000000303',:'tenant','Already received','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000201']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000303',null,30000,80000,'f7800000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7800000-0000-4000-8000-000000000503','f7800000-0000-4000-8000-000000000403','f7800000-0000-4000-8000-000000000101',null,null);
select read_external_item_onboarding('f7800000-0000-4000-8000-000000000403')#>>'{handover,id}' as received_handover \gset
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select receive_handover(:'tenant',gen_random_uuid(),:'received_handover','staff_receipt','');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000003","role":"authenticated"}';
select reserve_external_item_photo('f7800000-0000-4000-8000-000000000204',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7800000-0000-4000-8000-000000000003/f7800000-0000-4000-8000-000000000204.jpg');
select submit_external_item_request('f7800000-0000-4000-8000-000000000304',:'tenant','Foreign item','','good','',null,'SEK',array['f7800000-0000-4000-8000-000000000204']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000304',null,30000,80000,'f7800000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000003","role":"authenticated"}';
select complete_external_item_offer('f7800000-0000-4000-8000-000000000504','f7800000-0000-4000-8000-000000000404','f7800000-0000-4000-8000-000000000101','{"name":"Other seller","email":"other@example.test"}','{"holder":"Other seller","country":"SE","kind":"local","account":"123456789","routing":"8327"}');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(jsonb_array_length(read_central_parcel('f7800000-0000-4000-8000-000000000401')->'eligibleItems'),2,'both accepted unreceived items are selectable');
select throws_ok($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000402']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'42501',null,'seller cannot book groups without server capability');
select set_config('request.headers',jsonb_build_object('x-komisio-shipping',repeat('7',64))::text,true);
select throws_ok($$select claim_central_parcel_group(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000404']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'42501',null,'a foreign item rejects the complete selection');
select throws_like($$select claim_central_parcel_group(gen_random_uuid(),'f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000403']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%HANDOVER_CLOSED%','received goods cannot be added to an unreceived parcel');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',null,'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%INVALID_INPUT%','invalid selection cannot claim a parcel');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array[]::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%INVALID_INPUT%','invalid selection cannot claim a parcel');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000402']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%INVALID_INPUT%','invalid selection cannot claim a parcel');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000401']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%INVALID_INPUT%','invalid selection cannot claim a parcel');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401',null]::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%INVALID_INPUT%','invalid selection cannot claim a parcel');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array_fill('f7800000-0000-4000-8000-000000000401'::uuid,array[11]),'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%INVALID_INPUT%','invalid selection cannot claim a parcel');
select throws_ok($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000499']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'42501',null,'unknown or unowned item rejects the whole selection');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000402']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','production')$$,'%SHIPPING_UNAVAILABLE%','runtime environment cannot be changed');
select is((select count(*) from central_parcels),0::bigint,'invalid selections leave no partial parcel');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401','f7800000-0000-4000-8000-000000000402']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')->>'dispatch','true','one group creates one dispatch');
select is(claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000402','f7800000-0000-4000-8000-000000000401']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')->>'dispatch','false','reordering the same selection replays without dispatch');
select throws_like($$select claim_central_parcel_group('f7800000-0000-4000-8000-000000000601','f7800000-0000-4000-8000-000000000401',array['f7800000-0000-4000-8000-000000000401']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%REQUEST_CONFLICT%','selection cannot be changed after dispatch');
select throws_like($$select claim_central_parcel_group(gen_random_uuid(),'f7800000-0000-4000-8000-000000000402',array['f7800000-0000-4000-8000-000000000402']::uuid[],'{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}','sandbox')$$,'%PARCEL_EXISTS%','overlapping selection cannot buy another label');
select throws_like($$select claim_central_parcel(gen_random_uuid(),'f7800000-0000-4000-8000-000000000402','{"street":"Testvägen 2","postalCode":"12345","city":"Teststad"}',null,null,null,null,'sandbox')$$,'%PARCEL_EXISTS%','legacy singleton cannot rebook a bundled item');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000401')->'parcel',read_central_parcel('f7800000-0000-4000-8000-000000000402')->'parcel','all selected items expose the same parcel');
select is(jsonb_array_length(read_central_parcel('f7800000-0000-4000-8000-000000000402')#>'{parcel,items}'),2,'manifest includes both items');
select is(jsonb_array_length(read_central_parcel('f7800000-0000-4000-8000-000000000401')->'eligibleItems'),0,'booked items leave the selection');
select is((select count(*) from external_item_guarantees),1::bigint,'group booking never starts another guarantee');
select lives_ok($$select finish_central_parcel('f7800000-0000-4000-8000-000000000601','{"bookingId":"synthetic","returnId":"synthetic-return","trackingId":"003700000000000001","qrPng":"data:image/png;base64,iVBORw0KGgo="}')$$,'one provider result belongs to the whole parcel');
select is(read_central_parcel('f7800000-0000-4000-8000-000000000402')#>>'{parcel,booking,returnId}','synthetic-return','second item shows the same return code');
select throws_ok(format($$select handover_parcels(%L,array[]::uuid[])$$,:'tenant'),'42501',null,'seller cannot use the staff manifest endpoint');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select read_central_parcel('f7800000-0000-4000-8000-000000000401')$$,'42501',null,'foreign identity cannot see package contents');
select is((select count(*) from central_parcel_items),0::bigint,'RLS hides the selected items');
set local request.jwt.claims='{"sub":"f7800000-0000-4000-8000-000000000001","role":"authenticated"}';
select handover_id as handover from central_parcel_items where offer_id='f7800000-0000-4000-8000-000000000401' \gset
select is(jsonb_array_length(handover_parcels(:'tenant',array[:'handover']::uuid[])#>'{0,items}'),2,'staff resolving any H-reference see the whole manifest');
select lives_ok(format($$select receive_handover(%L,gen_random_uuid(),%L,'staff_receipt','')$$,:'tenant',:'handover'),'first item can be received independently');
select is((select count(*) from external_item_guarantees),2::bigint,'first receipt starts only its guarantee');
select is((select h.status from seller_handovers h join central_parcel_items i on i.handover_id=h.id where i.offer_id='f7800000-0000-4000-8000-000000000402'),'open','second item still requires actual receipt');
select handover_id as second_handover from central_parcel_items where offer_id='f7800000-0000-4000-8000-000000000402' \gset
select lives_ok(format($$select receive_handover(%L,gen_random_uuid(),%L,'staff_receipt','')$$,:'tenant',:'second_handover'),'second physical receipt remains explicit');
select is((select count(*) from external_item_guarantees),3::bigint,'both receipts keep separate guarantees');
select is((select count(*) from seller_ledger_entries),0::bigint,'shipping never changes balances');
select * from finish(); rollback;
