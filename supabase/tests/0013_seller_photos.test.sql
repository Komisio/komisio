begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('a0000000-0000-4000-8000-000000000001','owner@photos.test',now()),
 ('a0000000-0000-4000-8000-000000000002','seller@photos.test',now()),
 ('a0000000-0000-4000-8000-000000000003','other@photos.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.a',create_tenant('Seller Photos','seller-photos',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.a')::uuid,gen_random_uuid(),'Seller','seller@photos.test','')::text,true);
select set_config('test.session',create_reception_session(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.a')::uuid,gen_random_uuid(),null,'TEST terms','Fictional terms','en',false)::text,true);
select set_config('test.prefix',current_setting('test.a')||'/'||current_setting('test.session')||'/',true);
select set_config('test.photo','a0000000-0000-4000-8000-000000000010',true);
select set_config('test.late','a0000000-0000-4000-8000-000000000011',true);
insert into storage.objects(bucket_id,name) values
 ('reception-photos',current_setting('test.prefix')||current_setting('test.photo')||'.png'),
 ('reception-photos',current_setting('test.prefix')||current_setting('test.late')||'.png'),
 ('seller-reception-photos',current_setting('test.prefix')||current_setting('test.photo')||'.jpg');
select set_config('test.sources',jsonb_build_array(
 jsonb_build_object('id',current_setting('test.photo'),'kind','photo','reference',current_setting('test.prefix')||current_setting('test.photo')||'.png','observation',''),
 jsonb_build_object('id',current_setting('test.late'),'kind','photo','reference',current_setting('test.prefix')||current_setting('test.late')||'.png','observation',''),
 jsonb_build_object('id','a0000000-0000-4000-8000-000000000012','kind','price-evidence','reference','TEST appraisal','observation','Fictional 250 SEK'))::text,true);
select save_reception_sources(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,current_setting('test.sources')::jsonb);
select set_config('test.suggestions','{"attributes":[{"slug":"description","definitionVersion":1,"value":"TEST jacket","sourceIds":["a0000000-0000-4000-8000-000000000010"],"certainty":"observed"}],"price":{"currency":"SEK","amount":"250.00","rationale":"TEST appraisal","sourceIds":["a0000000-0000-4000-8000-000000000012"]},"questions":[]}',true);
select set_config('test.review',gen_random_uuid()::text,true);
select publish_reception_review(current_setting('test.a')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day');
select is((select photo_sources from reception_reviews where id=current_setting('test.review')::uuid),array[current_setting('test.photo')::uuid],'publication pins only available derivatives');
insert into storage.objects(bucket_id,name) values('seller-reception-photos',current_setting('test.prefix')||current_setting('test.late')||'.jpg');
select is((select cardinality(photo_sources) from reception_reviews where id=current_setting('test.review')::uuid),1,'late derivative cannot change published review');
select set_config('test.link',gen_random_uuid()::text,true);
select set_reception_access(current_setting('test.a')::uuid,current_setting('test.link')::uuid,current_setting('test.review')::uuid,null,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(read_seller_review(repeat('a',64))->'photos',jsonb_build_array(current_setting('test.photo')),'seller gets exact pinned IDs, no storage paths');
select is(read_seller_review_photo(repeat('a',64),current_setting('test.photo')::uuid),current_setting('test.prefix')||current_setting('test.photo')||'.jpg','authenticated capability resolves exact derivative');
select throws_like($$select read_seller_review_photo(repeat('a',64),current_setting('test.late')::uuid)$$,'%REVIEW_UNAVAILABLE%','unpinned derivative withheld');
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'matching email alone cannot enumerate derivatives');
select set_config('request.headers',jsonb_build_object('x-komisio-review-token',repeat('a',64))::text,true);
select set_config('storage.operation','storage.object.sign',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'seller cannot create signed URLs');
select set_config('storage.operation','storage.object.list',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'seller cannot list objects');
select set_config('storage.operation','storage.object.get_authenticated',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),1::bigint,'authenticated download sees only exact pinned derivative');
select set_config('storage.operation','object.get_authenticated_info',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),1::bigint,'hosted authenticated info sees only exact pinned derivative');
select set_config('storage.operation','storage.object.get_authenticated_info',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),1::bigint,'prefixed authenticated info is equivalent');
select set_config('storage.operation','object.get_authenticated',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),1::bigint,'unprefixed authenticated download is equivalent');
select set_config('storage.operation','object.sign',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'unprefixed signing remains denied');
select set_config('storage.operation','object.list',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'unprefixed listing remains denied');
select set_config('storage.operation','',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'missing operation fails closed');
select set_config('storage.operation','object.get_authenticated_info',true);
select set_config('request.headers','{}',true);
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'info without capability is denied');
select set_config('request.headers',jsonb_build_object('x-komisio-review-token',repeat('a',64))::text,true);
select is((select count(*) from storage.objects where bucket_id='reception-photos'),0::bigint,'originals remain staff-only with valid capability');
select throws_ok($$insert into storage.objects(bucket_id,name) values('seller-reception-photos',current_setting('test.prefix')||gen_random_uuid()::text||'.jpg')$$,'42501',null,'seller cannot upload derivative');
with changed as(update storage.objects set metadata='{}' where bucket_id='seller-reception-photos' returning id) select is((select count(*) from changed),0::bigint,'seller cannot alter pinned image');
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'wrong account with capability denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'a0000000-0000-4000-8000-000000000002','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'MFA enforced inside Storage');
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),1::bigint,'verified MFA restores exact image');
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_reception_access(current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.review')::uuid,current_setting('test.link')::uuid,null);
set local "request.jwt.claims"='{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'revocation blocks subsequent Storage downloads');
select throws_like($$select read_seller_review_photo(repeat('a',64),current_setting('test.photo')::uuid)$$,'%REVIEW_UNAVAILABLE%','revocation also blocks app descriptor');
set local role anon;
select is((select count(*) from storage.objects where bucket_id='seller-reception-photos'),0::bigint,'anonymous image access denied');
select * from finish();
rollback;
