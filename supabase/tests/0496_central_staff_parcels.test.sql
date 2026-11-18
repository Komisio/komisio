begin;
select no_plan();
create function pg_temp.uid(n bigint) returns uuid language sql immutable as $$ select ('f4950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,email,email_confirmed_at) values
(pg_temp.uid(1),'fixed-staff@example.test',now()),(pg_temp.uid(2),'fixed-seller@example.test',now()),
(pg_temp.uid(3),'fixed-other@example.test',now()),(pg_temp.uid(4),'fixed-reader@example.test',now());
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select create_tenant('Synthetic central fixed price','synthetic-central-fixed-price',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic ordinary store','synthetic-fixed-ordinary',gen_random_uuid()) as other \gset
select publish_seller_agreement(:'tenant',pg_temp.uid(10),null,'Terms 1','Synthetic terms','sv',true);
reset role;
update platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant',pg_temp.uid(4),'readonly');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select is(read_central_intake_profile()->'account','null'::jsonb,'new seller has no account');
select throws_like(format($$select save_central_intake_profile(%L,%L,%L,-1,'{"street":"Test street 1","postalCode":"12345","city":"Test city"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',false)$$,pg_temp.uid(20),:'tenant',pg_temp.uid(10)),'%AGREEMENT_REQUIRED%','first use requires explicit consent');
select is(save_central_intake_profile(pg_temp.uid(20),:'tenant',pg_temp.uid(10),-1,'{"street":"Test street 1","postalCode":"12345","city":"Test city"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',true),pg_temp.uid(20),'profile and terms saved without bank');
select lives_ok(format($$select save_central_intake_profile(%L,%L,%L,-1,'{"street":"Test street 1","postalCode":"12345","city":"Test city"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',true)$$,pg_temp.uid(20),:'tenant',pg_temp.uid(10)),'exact profile retry');
select is(read_central_intake_profile()->>'agreementAccepted','true','consent reused');
select is(read_central_intake_profile()#>>'{account,contact,firstName}','Test','contact visible');
select read_central_intake_profile()#>>'{account,sellerId}' as seller \gset
select reserve_external_item_photo(pg_temp.uid(100),repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(100)||'.jpg');
reset role;
insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,encode(sha256(convert_to(repeat('6',64),'UTF8')),'hex'));
set local role authenticated;
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('6',64))::text,true);
select verify_external_item_photo(pg_temp.uid(100),repeat('a',64),100);
select begin_external_photo_analysis(pg_temp.uid(80),:'tenant',array[pg_temp.uid(100)],'synthetic','sv','central-photo-v2-weight');
select complete_external_photo_analysis(pg_temp.uid(80),'{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":350}',100,10);
set local request.headers='{}';
select submit_central_item_request(pg_temp.uid(101),:'tenant','Dress','','good','',60000,'SEK',array[pg_temp.uid(100)],'SE','seller_amount',pg_temp.uid(10));
select submit_central_item_request(pg_temp.uid(102),:'tenant','Jacket','','good','',70000,'SEK',array[pg_temp.uid(100)],'SE','seller_amount',pg_temp.uid(10));
select reserve_external_item_photo(pg_temp.uid(105),repeat('b',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(105)||'.jpg');
select submit_central_item_request(pg_temp.uid(103),:'tenant','Unknown weight 1','','good','',60000,'SEK',array[pg_temp.uid(105)],'SE','seller_amount',pg_temp.uid(10));
select submit_central_item_request(pg_temp.uid(104),:'tenant','Unknown weight 2','','good','',60000,'SEK',array[pg_temp.uid(105)],'SE','seller_amount',pg_temp.uid(10));
reset role;
insert into komisio_private.central_shipping_runtime(singleton,key_hash,tenant_id,environment,recipient,service_code)
 values(true,encode(sha256(convert_to(repeat('7',64),'UTF8')),'hex'),:'tenant','sandbox',
 '{"name":"Synthetic company","street":"Test street 2","postalCode":"12345","city":"Test city","country":"SE","phone":"+46700000000","email":"parcel@example.test"}','11');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select jsonb_build_array(jsonb_build_object('requestId',pg_temp.uid(101),'expectedSalePriceOre','100000'),jsonb_build_object('requestId',pg_temp.uid(102),'expectedSalePriceOre','120000')) as selection \gset
select throws_like(format($$select review_central_item_group(%L,%L,%L,%L,true,1,'sandbox')$$,pg_temp.uid(300),:'tenant',pg_temp.uid(2),:'selection'),'%FORBIDDEN%','booking requires server capability');
select set_config('request.headers',jsonb_build_object('x-komisio-shipping',repeat('7',64))::text,true);
select throws_like(format($$select review_central_item_group(%L,%L,%L,%L,true,99,'sandbox')$$,pg_temp.uid(302),:'tenant',pg_temp.uid(2),:'selection'),'%PROFILE_CHANGED%','changed profile cannot be booked from stale preview');
select throws_like(format($$select review_central_item_group(%L,%L,%L,%L,true,1,'sandbox')$$,pg_temp.uid(302),:'tenant',pg_temp.uid(3),:'selection'),'%REQUEST_NOT_FOUND%','mixed seller selection rejected');
select jsonb_build_array(jsonb_build_object('requestId',pg_temp.uid(103),'expectedSalePriceOre','100000'),jsonb_build_object('requestId',pg_temp.uid(104),'expectedSalePriceOre','100000')) as heavy \gset
select throws_like(format($$select review_central_item_group(%L,%L,%L,%L,true,1,'sandbox')$$,pg_temp.uid(303),:'tenant',pg_temp.uid(2),:'heavy'),'%PARCEL_WEIGHT_LIMIT%','unknown weight stays conservative and cannot be overbooked');
select is((select count(*) from external_item_offers where request_id in(pg_temp.uid(103),pg_temp.uid(104))),0::bigint,'failed parcel validation rolls back approvals atomically');
select is(review_central_item_group(pg_temp.uid(300),:'tenant',pg_temp.uid(2),:'selection',true,1,'sandbox')->>'dispatch','true','one claim approves and groups two items');
select is(review_central_item_group(pg_temp.uid(300),:'tenant',pg_temp.uid(2),:'selection',true,1,'sandbox')->>'dispatch','false','retry never dispatches twice');
select throws_like(format($$select review_central_item_group(%L,%L,%L,%L,true,1,'sandbox')$$,pg_temp.uid(301),:'tenant',pg_temp.uid(2),:'selection'),'%PARCEL_EXISTS%','another operation cannot book the same goods');
select finish_staff_central_parcel(pg_temp.uid(300),'{"bookingId":"synthetic","returnId":"synthetic","trackingId":"12345","qrPng":"data:image/png;base64,iVBORw0KGgo="}');
select lives_ok(format($$select finish_staff_central_parcel(%L,'{"bookingId":"synthetic","returnId":"synthetic","trackingId":"12345","qrPng":"data:image/png;base64,iVBORw0KGgo="}')$$,pg_temp.uid(300)),'finish retry');
reset role;
select is((select count(*) from central_parcels where id=pg_temp.uid(300)),1::bigint,'one parcel');
select is((select count(*) from central_parcel_items where parcel_id=pg_temp.uid(300)),2::bigint,'two manifest items');
select is((select estimated_weight_g from central_parcels where id=pg_temp.uid(300)),800,'two 350g items plus existing 100g packaging');
select is((select booked_by from central_parcels where id=pg_temp.uid(300)),pg_temp.uid(1),'booking actor is staff');
select is((select count(*) from seller_ledger_entries where seller_id=:'seller'),0::bigint,'booking does not credit money');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select id as offer from external_item_offers where request_id=pg_temp.uid(101) \gset
select is(read_central_parcel(:'offer')->>'staffManaged','true','mobile knows staff owns booking');
select is(read_central_parcel(:'offer')#>>'{parcel,status}','booked','seller sees the QR');
select is(jsonb_array_length(read_central_parcel(:'offer')#>'{parcel,items}'),2,'seller sees all contents');
select is(read_central_parcel(:'offer')#>>'{parcel,sender,name}','Test Seller','uses saved sender name');
select id as offer2 from external_item_offers where request_id=pg_temp.uid(102) \gset
select is(read_central_parcel(:'offer2')#>>'{parcel,id}',read_central_parcel(:'offer')#>>'{parcel,id}','both items show same parcel');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(3),'role','authenticated')::text,true);
select throws_like(format($$select read_central_parcel(%L)$$,:'offer'),'%OFFER_NOT_FOUND%','another seller cannot read code');
select throws_like(format($$select claim_staff_central_parcel(%L,%L,%L,array[%L]::uuid[],1,'sandbox')$$,pg_temp.uid(400),:'tenant',pg_temp.uid(2),:'offer'),'%FORBIDDEN%','seller cannot book as staff');
select * from finish(); rollback;
