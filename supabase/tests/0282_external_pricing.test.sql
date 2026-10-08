begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000008001','submission-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000008002','submission-seller@example.test',now()),
 ('f0000000-0000-4000-8000-000000008003','submission-stranger@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Submissions test','submissions-test',gen_random_uuid())::text,true);
select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"address":{"street":"","postalCode":"","city":"","country":"SE"},"contact":{"email":"","phone":"","website":""},"openingHours":[],"accepts":"","concept":"","language":"sv"}');
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','submission-seller@example.test','')::text,true);
select set_config('test.id',gen_random_uuid()::text,true);
select set_config('test.path',current_setting('test.tenant')||'/'||current_setting('test.seller')||'/'||gen_random_uuid()::text||'.jpg',true);
select set_config('test.photos',jsonb_build_array(current_setting('test.path'))::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008002","role":"authenticated"}';
insert into storage.objects(bucket_id,name) values('seller-submission-photos',current_setting('test.path'));
reset role;
update platform_settings set ai_credits_enabled=true,ai_included_ore=10000,ai_monthly_cap_ore=100000000,ai_reserve_batch_ore=200;
insert into komisio_private.seller_ai_runtime values(true,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash;
set local role authenticated;
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('a',64))::text,true);
select is(begin_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,current_setting('test.photos')::jsonb,'test-model',10)->'context'->>'webRateOre','10','Swedish search budget retained');
select set_config('test.comparison', jsonb_build_object('from','100.00','to','200.00','basis','asking','observedAt',clock_timestamp(),'sources',jsonb_build_array(
 jsonb_build_object('url','https://example.com/item/1','title','Blue jacket','amount','100.00','condition','Used','status','asking','soldAt',null,'country','SE','currency','SEK','priceBasis','item_only'),
 jsonb_build_object('url','https://example.org/item/2','title','Similar jacket','amount','200.00','condition','Used','status','asking','soldAt',null,'country','SE','currency','SEK','priceBasis','item_only')))::text,true);
select set_config('test.output',jsonb_build_object('description','Jacket','price',null,'suitability','uncertain','reason','Review','externalComparison',current_setting('test.comparison')::jsonb)::text,true);
select throws_like($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,jsonb_set(current_setting('test.output')::jsonb,'{externalComparison,to}','"50.00"'),1,1,1)$$,'%INVALID_INPUT%','reversed external range rejected');
select throws_like($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,jsonb_set(current_setting('test.output')::jsonb,'{externalComparison,sources,0,currency}','"EUR"'),1,1,1)$$,'%INVALID_INPUT%','foreign currency rejected');
select throws_like($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,jsonb_set(current_setting('test.output')::jsonb,'{externalComparison,sources,0,url}','"https://example.org/item/2"'),1,1,1)$$,'%INVALID_INPUT%','duplicate sources rejected');
select throws_like($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,current_setting('test.output')::jsonb,1,1,5)$$,'%INVALID_INPUT%','search budget bounded');
select throws_like($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,jsonb_set(current_setting('test.output')::jsonb,'{externalComparison,observedAt}','null'),1,1,1)$$,'%INVALID_INPUT%','retrieval date required');
select lives_ok($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,current_setting('test.output')::jsonb,1,1,1)$$,'external comparison saved');
select lives_ok($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,current_setting('test.output')::jsonb,1,1,1)$$,'replay does not charge twice');
reset role;
select is((select output->'externalComparison'->>'basis' from seller_ai_results where id=current_setting('test.id')::uuid),'asking','asking provenance retained');
select is((select web_calls from seller_ai_results where id=current_setting('test.id')::uuid),1,'search usage retained');
select is((select amount_ore from ai_credit_events where tenant_id=current_setting('test.tenant')::uuid and kind='reserved'),-240::bigint,'reserves token budget plus four searches');
select is((select sum(amount_ore)::bigint from ai_credit_events where tenant_id=current_setting('test.tenant')::uuid and kind in ('reserved','settled')),-11::bigint,'settles one search plus token use once');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Other market','other-market',gen_random_uuid())::text,true);
select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"address":{"street":"","postalCode":"","city":"","country":"DE"},"contact":{"email":"","phone":"","website":""},"openingHours":[],"accepts":"","concept":"","language":"sv"}');
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','submission-seller@example.test','')::text,true);
select set_config('test.id',gen_random_uuid()::text,true);
select set_config('test.path',current_setting('test.tenant')||'/'||current_setting('test.seller')||'/'||gen_random_uuid()::text||'.jpg',true);
select set_config('test.photos',jsonb_build_array(current_setting('test.path'))::text,true);
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000008002","role":"authenticated"}';
insert into storage.objects(bucket_id,name) values('seller-submission-photos',current_setting('test.path'));
select ok(not((begin_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,current_setting('test.photos')::jsonb,'test-model',10)->'context') ? 'webRateOre'),'Swedish language never selects Sweden for a German store');
select throws_like($$select complete_seller_photo_assistance(current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,current_setting('test.id')::uuid,current_setting('test.output')::jsonb,1,1,1)$$,'%INVALID_INPUT%','external comparison cannot bypass market selection');
reset role;
select * from finish();
rollback;
