begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f4780000-0000-4000-8000-000000000001','ai-owner@example.test',now(),null,null),
 ('f4780000-0000-4000-8000-000000000002',null,null,'46700004782',now()),
 ('f4780000-0000-4000-8000-000000000003',null,null,'46700004783',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f4780000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic AI intake','synthetic-ai-intake',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic other AI','synthetic-other-ai',gen_random_uuid()) as other \gset
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant',ai_credits_enabled=true,ai_included_ore=10000,ai_monthly_cap_ore=1000000;
insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,encode(extensions.digest(repeat('a',64),'sha256'),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash;
set local role authenticated;
set local request.headers='{}';
set local request.jwt.claims='{"sub":"f4780000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f4780000-0000-4000-8000-000000000101',repeat('b',64),100);
create function pg_temp.start_ai(i uuid,t uuid,p uuid[] default array['f4780000-0000-4000-8000-000000000101']::uuid[]) returns jsonb language sql as $$
 select public.begin_external_photo_analysis(i,t,p,'synthetic-model','sv');
$$;
select throws_like(format($$select pg_temp.start_ai(gen_random_uuid(),%L)$$,:'tenant'),'%FORBIDDEN%','user alone cannot spend AI credits');
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('a',64))::text,true);
select throws_like(format($$select pg_temp.start_ai(gen_random_uuid(),%L)$$,:'other'),'%STORE_UNAVAILABLE%','another store cannot fund central AI');
select throws_like(format($$select pg_temp.start_ai(gen_random_uuid(),%L)$$,:'tenant'),'%PHOTO_NOT_FOUND%','all photos must finish uploading first');
insert into storage.objects(bucket_id,name) values('external-item-photos','f4780000-0000-4000-8000-000000000002/f4780000-0000-4000-8000-000000000101.jpg');
select is(pg_temp.start_ai('f4780000-0000-4000-8000-000000000201',:'tenant')->>'reserved','true','first explicit request reserves one analysis');
select is(pg_temp.start_ai('f4780000-0000-4000-8000-000000000201',:'tenant')->>'reserved','false','retry never reserves twice');
select is(my_external_photo_analysis('f4780000-0000-4000-8000-000000000201')->>'status','pending','lost request remains pending');
select throws_like(format($$select begin_external_photo_analysis('f4780000-0000-4000-8000-000000000201',%L,array['f4780000-0000-4000-8000-000000000101']::uuid[],'synthetic-model','en')$$,:'tenant'),'%REQUEST_CONFLICT%','retry cannot change language');
select throws_like(format($$select pg_temp.start_ai(gen_random_uuid(),%L)$$,:'tenant'),'%ASSISTANCE_LIMIT%','rapid new requests are bounded');
select throws_like($$select complete_external_photo_analysis('f4780000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"imaginary","notes":""}',100,10)$$,'%INVALID_INPUT%','invalid proposals cannot be saved');
select complete_external_photo_analysis('f4780000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"good","notes":""}',100,10);
select lives_ok($$select complete_external_photo_analysis('f4780000-0000-4000-8000-000000000201','{"description":"Dress","brand":null,"condition":"good","notes":""}',100,10)$$,'completion retry is idempotent');
select is(my_external_photo_analysis('f4780000-0000-4000-8000-000000000201')#>>'{output,description}','Dress','owner reads persisted proposal');
select throws_like($$select complete_external_photo_analysis('f4780000-0000-4000-8000-000000000201',null,0,0)$$,'%REQUEST_CONFLICT%','completed proposal cannot be replaced');
select throws_ok($$insert into external_photo_ai_results(id,tenant_id,output,input_tokens,output_tokens) values(gen_random_uuid(),gen_random_uuid(),null,0,0)$$,'42501',null,'direct fabrication denied');
set local request.jwt.claims='{"sub":"f4780000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(my_external_photo_analysis('f4780000-0000-4000-8000-000000000201'),null::jsonb,'other user cannot read result');
select throws_like(format($$select pg_temp.start_ai(gen_random_uuid(),%L)$$,:'tenant'),'%PHOTO_NOT_FOUND%','other user cannot analyze photos');
select throws_like($$select complete_external_photo_analysis('f4780000-0000-4000-8000-000000000201',null,0,0)$$,'%FORBIDDEN%','server capability does not replace ownership');
set local request.jwt.claims='{"sub":"f4780000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$select external_photo_ai_configuration(%L)$$,:'tenant'),'%PHONE_VERIFICATION_REQUIRED%','store access does not replace phone verification');
reset role;
select is((select count(*) from external_photo_ai_attempts where tenant_id=:'tenant'),1::bigint,'one immutable attempt');
select is((select count(*) from external_photo_ai_results where tenant_id=:'tenant'),1::bigint,'one immutable result');
select is((select count(*) from usage_events where tenant_id=:'tenant' and feature='reception_assistance'),1::bigint,'AI quota meters once');
select is((select count(*) from ai_credit_events where tenant_id=:'tenant' and kind='reserved'),1::bigint,'one reservation against the central store budget');
select is((select count(*) from ai_credit_events where tenant_id=:'tenant' and kind='settled'),1::bigint,'one cost settlement even after repeated completion');
select is((select -sum(amount_ore) from ai_credit_events where tenant_id=:'tenant' and kind in ('reserved','settled')),komisio_private.ai_cost_ore(100,10)::numeric,'the existing numeric token rates determine the settled cost');
select is((select count(*) from sellers where tenant_id=:'tenant'),0::bigint,'no seller created');
select is((select count(*) from external_item_requests where tenant_id=:'tenant'),0::bigint,'no request submitted');
select is((select count(*) from tenant_members where user_id='f4780000-0000-4000-8000-000000000002'),0::bigint,'no membership granted');
select throws_like($$update external_photo_ai_results set output=null$$,'%IMMUTABLE%','result evidence is immutable');
select * from finish();
rollback;
