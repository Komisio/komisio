begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d4350000-0000-4000-8000-000000000001','catalogue-owner@example.test',now()),
 ('d4350000-0000-4000-8000-000000000002','catalogue-reader@example.test',now()),
 ('d4350000-0000-4000-8000-000000000003','catalogue-consignor@example.test',now()),
 ('d4350000-0000-4000-8000-000000000004','catalogue-outsider@example.test',now()),
 ('d4350000-0000-4000-8000-000000000005','catalogue-twice@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic catalogue store','catalogue-store',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic reader','catalogue-reader@example.test','') as reader \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic consignor','catalogue-consignor@example.test','') as consignor \gset
select register_seller(:'tenant',gen_random_uuid(),'Twice one','catalogue-twice@example.test','');
select register_seller(:'tenant',gen_random_uuid(),'Twice two','catalogue-twice@example.test','');
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","salePeriodDays":42,"markdownSteps":[]}');
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'consignor','',null) as bag \gset
select set_config('test.tenant',:'tenant',true),set_config('test.bag',:'bag',true);
create function pg_temp.catalogue_item(title text,attrs jsonb default '[]') returns uuid language plpgsql as $$
declare d uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); t uuid:=current_setting('test.tenant')::uuid;
begin
 perform pg_temp.prepare_bag_reception(t,gen_random_uuid(),current_setting('test.bag')::uuid,d,0,title,'Jackets','Good',attrs);
 perform public.accept_item(t,i,'reception_review',d,1,25000);
 return i;
end $$;
select pg_temp.catalogue_item('Synthetic wool coat',jsonb_build_array(
 jsonb_build_object('slug','description','definitionVersion',1,'value','Synthetic wool coat','certainty','observed'),
 jsonb_build_object('slug','category','definitionVersion',1,'value','Jackets','certainty','observed'),
 jsonb_build_object('slug','size','definitionVersion',1,'value','M','certainty','observed'),
 jsonb_build_object('slug','brand','definitionVersion',1,'value','Synthetic brand','certainty','observed'),
 jsonb_build_object('slug','condition','definitionVersion',1,'value','Good','certainty','observed'))) as coat \gset
select pg_temp.catalogue_item('Synthetic lamp') as lamp \gset
select pg_temp.catalogue_item('Synthetic sold chair') as sold \gset
select pg_temp.catalogue_item('Synthetic ended vase') as ended \gset
select pg_temp.catalogue_item('Synthetic expired bag') as expired \gset
-- Transaction-local fixture time travel only; production history stays immutable.
reset role;
alter table public.items disable trigger items_immutable;
update public.items set accepted_at=now()-interval '43 days' where id=:'expired';
update public.items set accepted_at=now()-interval '1 day' where id=:'coat';
update public.items set accepted_at=now()-interval '1 hour' where id=:'lamp';
alter table public.items enable trigger items_immutable;
set local role authenticated;
select end_sale_period(:'tenant',gen_random_uuid(),:'ended','charity','Synthetic handover');
select record_sale(:'tenant',gen_random_uuid(),'manual','CATALOGUE-1',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'sold','priceOre',9000)));
-- Photos: one current, one detached, one on the sold item.
select set_config('test.photo',gen_random_uuid()::text,true),set_config('test.gone',gen_random_uuid()::text,true),set_config('test.soldphoto',gen_random_uuid()::text,true);
select :'tenant'||'/'||:'coat'||'/'||current_setting('test.photo')||'.jpg' as path,
 :'tenant'||'/'||:'coat'||'/'||current_setting('test.gone')||'.jpg' as gone,
 :'tenant'||'/'||:'sold'||'/'||current_setting('test.soldphoto')||'.jpg' as soldpath \gset
insert into storage.objects(bucket_id,name) values('item-photos',:'path'),('item-photos',:'gone'),('item-photos',:'soldpath');
select change_item_photo(:'tenant',gen_random_uuid(),:'coat',0,'add',current_setting('test.gone')::uuid);
select change_item_photo(:'tenant',gen_random_uuid(),:'coat',1,'add',current_setting('test.photo')::uuid);
select change_item_photo(:'tenant',gen_random_uuid(),:'coat',2,'remove',current_setting('test.gone')::uuid);
select change_item_photo(:'tenant',gen_random_uuid(),:'sold',0,'add',current_setting('test.soldphoto')::uuid);
-- A quick-received item inherits its reception photo.
select create_reception_session(:'tenant',gen_random_uuid(),:'consignor') as session \gset
select gen_random_uuid() as inherited \gset
select :'tenant'||'/'||:'session'||'/'||:'inherited'||'.jpg' as reception_path \gset
insert into storage.objects(bucket_id,name) values('reception-photos',:'reception_path');
select save_reception_sources(:'tenant',gen_random_uuid(),:'session',0,jsonb_build_array(jsonb_build_object('id',:'inherited','kind','photo','reference',:'reception_path','observation','')));
select quick_receive(:'tenant',gen_random_uuid(),:'session',:'consignor',1,'{"description":"Synthetic quick shirt"}',15000);

-- Hidden until the store shows itself in the app.
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select store_catalogue(current_setting('test.tenant')::uuid,'',0)$$,'42501','FORBIDDEN','catalogue is closed while the store is hidden from the app');
select is(catalogue_photo_access('item-photos',:'path'),false,'photos are closed while the store is hidden');
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.visible',gen_random_uuid()::text,true);
select set_store_app_visibility(:'tenant',current_setting('test.visible')::uuid,null,true);

-- A seller of the store reads what is for sale, and nothing about sellers or terms.
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000002","role":"authenticated"}';
select store_catalogue(:'tenant','',0) as page \gset
select is((:'page'::jsonb)->>'total','3','only unsold, unended items inside their period are listed');
select is((:'page'::jsonb)->>'currency','SEK','page carries the store currency');
select is((select array_agg(x->>'title' order by n) from jsonb_array_elements((:'page'::jsonb)->'items') with ordinality e(x,n)),array['Synthetic quick shirt','Synthetic lamp','Synthetic wool coat'],'newest first');
select is((select array_agg(k order by k) from jsonb_object_keys((:'page'::jsonb)->'items'->2) k),array['category','id','photo','priceOre','title'],'list rows carry no seller, terms or history');
select is(((:'page'::jsonb)->'items'->2->>'priceOre')::bigint,25000::bigint,'current price is listed');
select is((:'page'::jsonb)->'items'->2->'photo'->>'path',:'path','default photo is the current one');
select is((:'page'::jsonb)->'items'->1->'photo','null'::jsonb,'item without photos has none');
select is(store_catalogue(:'tenant','wool',0)->>'total','1','search matches titles');
select is(store_catalogue(:'tenant','',30)->'items','[]'::jsonb,'later pages may be empty');
select throws_like($$select store_catalogue(current_setting('test.tenant')::uuid,'',-1)$$,'%INVALID_INPUT%','negative offset refused');
select store_catalogue_item(:'tenant',:'coat') as detail \gset
select is((select array_agg(k order by k) from jsonb_object_keys(:'detail'::jsonb) k),array['currency','facts','id','photos','priceOre','title'],'detail carries no seller, terms or history');
select is((:'detail'::jsonb)->'facts',jsonb_build_array(
 jsonb_build_object('slug','category','value','Jackets'),jsonb_build_object('slug','brand','value','Synthetic brand'),
 jsonb_build_object('slug','size','value','M'),jsonb_build_object('slug','condition','value','Good')),'listed facts in fixed order, description excluded');
select is(jsonb_array_length((:'detail'::jsonb)->'photos'),1,'detached photos are not listed');
select throws_like(format('select store_catalogue_item(%L,%L)',:'tenant',:'sold'),'%ITEM_NOT_FOUND%','sold items are not readable');
select throws_like(format('select store_catalogue_item(%L,%L)',:'tenant',:'ended'),'%ITEM_NOT_FOUND%','ended items are not readable');
select throws_like(format('select store_catalogue_item(%L,%L)',:'tenant',:'expired'),'%ITEM_NOT_FOUND%','items past their period are not readable');
select throws_like(format('select store_catalogue_item(%L,%L)',:'tenant',gen_random_uuid()),'%ITEM_NOT_FOUND%','unknown items are not readable');

-- Photo downloads follow the same listing.
select is(catalogue_photo_access('item-photos',:'path'),true,'seller may download a current photo of an item for sale');
select is((select count(*) from storage.objects where bucket_id='item-photos' and name=:'path'),1::bigint,'storage policy admits the current photo');
select is((select count(*) from storage.objects where bucket_id='item-photos' and name in (:'gone',:'soldpath')),0::bigint,'detached and sold photos stay closed');
select is((:'page'::jsonb)->'items'->0->'photo'->>'bucket','reception-photos','inherited reception photo is listed');
select is((select count(*) from storage.objects where bucket_id='reception-photos' and name=:'reception_path'),1::bigint,'storage policy admits an inherited reception photo');
select is(catalogue_photo_access('reception-photos',:'path'),false,'photo is matched with its bucket');
select is(catalogue_photo_access('item-photos','not/a/path.jpg'),false,'malformed paths are refused');
select throws_like(format($$insert into storage.objects(bucket_id,name) values('item-photos',%L)$$,:'tenant'||'/'||:'coat'||'/'||gen_random_uuid()||'.jpg'),'%row-level security%','sellers still cannot upload item photos');

-- Everyone else is refused.
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select store_catalogue(current_setting('test.tenant')::uuid,'',0)$$,'42501','FORBIDDEN','staff without a seller account use the staff reads');
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$select store_catalogue(current_setting('test.tenant')::uuid,'',0)$$,'42501','FORBIDDEN','non-sellers are refused');
select is(catalogue_photo_access('item-photos',:'path'),false,'non-sellers cannot download photos');
select is((select count(*) from storage.objects where bucket_id='item-photos' and name=:'path'),0::bigint,'storage stays closed to non-sellers');
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$select store_catalogue_item(current_setting('test.tenant')::uuid,null)$$,'42501','FORBIDDEN','ambiguous seller accounts are refused');
reset role;
set local role anon;
set local "request.jwt.claims"='{"role":"anon"}';
select throws_ok($$select store_catalogue(current_setting('test.tenant')::uuid,'',0)$$,'42501',null,'anonymous callers cannot read the catalogue');
select is(catalogue_photo_access('item-photos',:'path'),false,'anonymous callers cannot download photos');

-- Hiding the store closes the catalogue again.
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_store_app_visibility(:'tenant',gen_random_uuid(),current_setting('test.visible')::uuid,false);
set local "request.jwt.claims"='{"sub":"d4350000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select store_catalogue_item(current_setting('test.tenant')::uuid,null)$$,'42501','FORBIDDEN','hiding the store closes the catalogue');
select is((select count(*) from storage.objects where bucket_id='item-photos' and name=:'path'),0::bigint,'hiding the store closes photos');
select * from finish();
rollback;
