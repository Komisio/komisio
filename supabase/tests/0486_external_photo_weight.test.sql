begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f4860000-0000-4000-8000-000000000001','weight-owner@example.test',now(),null,null),
 ('f4860000-0000-4000-8000-000000000002',null,null,'46700004862',now()),
 ('f4860000-0000-4000-8000-000000000003',null,null,'46700004863',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f4860000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic weight intake','synthetic-weight-intake',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic other weight','synthetic-other-weight',gen_random_uuid()) as other \gset
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into komisio_private.seller_ai_runtime(singleton,key_hash)
 values(true,encode(extensions.digest(repeat('a',64),'sha256'),'hex'))
 on conflict(singleton) do update set key_hash=excluded.key_hash;
set local role authenticated;
set local request.jwt.claims='{"sub":"f4860000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f4860000-0000-4000-8000-000000000101',repeat('b',64),100);
select reserve_external_item_photo('f4860000-0000-4000-8000-000000000102',repeat('c',64),100);
insert into storage.objects(bucket_id,name) values
 ('external-item-photos','f4860000-0000-4000-8000-000000000002/f4860000-0000-4000-8000-000000000101.jpg'),
 ('external-item-photos','f4860000-0000-4000-8000-000000000002/f4860000-0000-4000-8000-000000000102.jpg');
create function pg_temp.start_weight(t uuid) returns jsonb language sql as $$
 select public.begin_external_photo_analysis('f4860000-0000-4000-8000-000000000201',t,
 array['f4860000-0000-4000-8000-000000000101']::uuid[],'synthetic-model','sv','central-photo-v2-weight');
$$;
set local request.headers='{}';
select throws_like(format($$select pg_temp.start_weight(%L)$$,:'tenant'),'%FORBIDDEN%','weight inference still requires the AI server capability');
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('a',64))::text,true);
select is(pg_temp.start_weight(:'tenant')->>'reserved','true','versioned weight analysis reserves one attempt');
select is(pg_temp.start_weight(:'tenant')->>'reserved','false','weight analysis retry does not invoke AI twice');
select throws_like(format($$select begin_external_photo_analysis('f4860000-0000-4000-8000-000000000201',%L,array['f4860000-0000-4000-8000-000000000101']::uuid[],'synthetic-model','sv')$$,:'tenant'),'%REQUEST_CONFLICT%','retry cannot change the prompt contract');
select throws_like($$select complete_external_photo_analysis('f4860000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":-1}',100,10)$$,'%INVALID_INPUT%','negative weight is not evidence');
select throws_like($$select complete_external_photo_analysis('f4860000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":400.5}',100,10)$$,'%INVALID_INPUT%','weights use whole grams');
select complete_external_photo_analysis('f4860000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":400}',100,10);
select lives_ok($$select complete_external_photo_analysis('f4860000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":400}',100,10)$$,'completion remains idempotent');
select ok(not((my_external_photo_analysis('f4860000-0000-4000-8000-000000000201')->'output')?'estimatedWeightG'),'mobile analysis response keeps its existing descriptive contract');
select is(my_external_photo_analysis('f4860000-0000-4000-8000-000000000201')#>>'{output,description}','Dress','seller still receives descriptive suggestions');
select submit_external_item_request('f4860000-0000-4000-8000-000000000301',:'tenant','Dress','','good','',null,'SEK',array['f4860000-0000-4000-8000-000000000101']::uuid[],'SE','seller_amount');
select submit_external_item_request('f4860000-0000-4000-8000-000000000302',:'tenant','Other item','','good','',null,'SEK',array['f4860000-0000-4000-8000-000000000102']::uuid[],'SE','seller_amount');
select submit_external_item_request('f4860000-0000-4000-8000-000000000303',:'tenant','Both photos','','good','',null,'SEK',array['f4860000-0000-4000-8000-000000000101','f4860000-0000-4000-8000-000000000102']::uuid[],'SE','seller_amount');
select throws_like(format($$select external_item_offer_queue_filtered(%L)$$,:'tenant'),'%AUTH_REQUIRED%','phone-only seller cannot read staff estimates');
set local request.jwt.claims='{"sub":"f4860000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(my_external_photo_analysis('f4860000-0000-4000-8000-000000000201'),null::jsonb,'other user cannot read analysis');
reset role;
select is((select weight_analysis_id from external_item_requests where id='f4860000-0000-4000-8000-000000000301'),'f4860000-0000-4000-8000-000000000201'::uuid,'submission freezes the exact analysis');
select is((select count(*) from external_item_requests where id in ('f4860000-0000-4000-8000-000000000302','f4860000-0000-4000-8000-000000000303') and weight_analysis_id is null),2::bigint,'missing or different photo sets never inherit an estimate');
select is((select prompt_version from external_photo_ai_attempts where id='f4860000-0000-4000-8000-000000000201'),'central-photo-v2-weight','prompt provenance is retained');
select throws_like($$update external_item_requests set weight_analysis_id=null where id='f4860000-0000-4000-8000-000000000301'$$,'%IMMUTABLE%','request estimate provenance cannot be overwritten');
set local role authenticated;
set local request.jwt.claims='{"sub":"f4860000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(external_item_offer_queue_filtered(:'tenant',0,'all','Dress')#>>'{rows,0,estimated_weight_g}','400','staff can see the frozen approximate item weight');
select is(external_item_offer_queue_filtered(:'other')->>'total','0','another tenant cannot obtain the estimate');
reset role;
select is((select count(*) from central_parcels where tenant_id=:'tenant'),0::bigint,'item weight analysis never books shipping');
select is((select count(*) from sellers where tenant_id=:'tenant'),0::bigint,'weight analysis does not create a seller or account balance');
select * from finish();
rollback;
