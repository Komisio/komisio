begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f9800000-0000-4000-8000-000000000001','guest-ai-owner@example.test',now()),
 ('f9800000-0000-4000-8000-000000000002','guest-ai-seller@example.test',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f9800000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic guest AI','synthetic-guest-ai',gen_random_uuid()) as tenant \gset
reset role;
update platform_settings set central_app_tenant_id=:'tenant',ai_credits_enabled=true,ai_included_ore=10000,ai_monthly_cap_ore=1000000;
insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash;
create function pg_temp.begin_guest(t uuid, i uuid default 'f9800000-0000-4000-8000-000000000101', h text default repeat('d',64)) returns jsonb language sql as $$
 select begin_guest_photo_analysis(i,t,repeat('b',64),repeat('c',64),h,array['f9800000-0000-4000-8000-000000000201']::uuid[],'sv','synthetic-model',now());
$$;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
set local request.headers='{}';
select throws_like(format($$select pg_temp.begin_guest(%L)$$,:'tenant'),'%FORBIDDEN%','publishable key alone cannot spend AI budget');
select throws_ok($$select * from guest_photo_ai_attempts$$,'42501',null,'guest analysis table is private');
select throws_like(format($$select guest_photo_ai_configuration(%L)$$,:'tenant'),'%FORBIDDEN%','anon cannot read provider configuration');
select throws_like($$select read_guest_photo_analysis(gen_random_uuid(),repeat('b',64))$$,'%FORBIDDEN%','anon cannot directly read guest results');
select throws_like($$select complete_guest_photo_analysis(gen_random_uuid(),repeat('b',64),'[]',null,0,0)$$,'%FORBIDDEN%','anon cannot complete guest results');
select throws_like($$select prune_guest_photo_analyses()$$,'%FORBIDDEN%','anon cannot purge guest records');
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('a',64))::text,true);
select is(pg_temp.begin_guest(:'tenant')->>'reserved','true','server capability reserves guest analysis without an Auth user');
select is(pg_temp.begin_guest(:'tenant')->>'reserved','false','lost response retries the existing attempt');
select throws_like(format($$select pg_temp.begin_guest(%L,'f9800000-0000-4000-8000-000000000101',repeat('e',64))$$,:'tenant'),'%REQUEST_CONFLICT%','same operation cannot change image evidence');
select is(read_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('e',64)),null::jsonb,'wrong guest capability reveals no result');
select throws_like(format($$select pg_temp.begin_guest(%L,gen_random_uuid())$$,:'tenant'),'%ASSISTANCE_LIMIT%','rapid guest requests are bounded');
select complete_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),jsonb_build_array(repeat('f',64)),
 '{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":350}',100,10);
select lives_ok($$select complete_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),jsonb_build_array(repeat('f',64)),
 '{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":350}',100,10)$$,'result and settlement replay exactly once');
select is(read_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64))#>>'{output,description}','Dress','capability holder reads descriptive suggestions');
select ok(not(read_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64))->'output' ? 'estimatedWeightG'),'weight is not exposed to guests');
select throws_like($$select complete_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),'[]',null,0,0)$$,'%REQUEST_CONFLICT%','completed result cannot be overwritten');
select throws_like(format($$select adopt_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),%L,array['f9800000-0000-4000-8000-000000000301']::uuid[])$$,:'tenant'),'%permission denied%','guest cannot adopt evidence or create a seller');
reset role;
select is((select count(*) from auth.users where email like 'guest-ai-%'),2::bigint,'analysis creates no Auth user');
select is((select count(*) from sellers where tenant_id=:'tenant'),0::bigint,'analysis creates no seller');
select is((select count(*) from external_item_requests where tenant_id=:'tenant'),0::bigint,'analysis creates no request');
select is((select count(*) from usage_events where tenant_id=:'tenant' and feature='reception_assistance'),1::bigint,'one quota charge');
select is((select count(*) from ai_credit_events where tenant_id=:'tenant' and kind='reserved'),1::bigint,'one budget reservation');
select is((select count(*) from ai_credit_events where tenant_id=:'tenant' and kind='settled'),1::bigint,'one budget settlement');
set local role authenticated;
set local request.jwt.claims='{"sub":"f9800000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f9800000-0000-4000-8000-000000000301',repeat('f',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f9800000-0000-4000-8000-000000000002/f9800000-0000-4000-8000-000000000301.jpg');
select is(adopt_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),:'tenant',array['f9800000-0000-4000-8000-000000000301']::uuid[]),null::uuid,'caller-supplied upload hashes cannot claim guest evidence');
select verify_external_item_photo('f9800000-0000-4000-8000-000000000301',repeat('f',64),100);
select ok(adopt_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),:'tenant',array['f9800000-0000-4000-8000-000000000301']::uuid[]) is not null,'verified uploaded contents preserve guest AI evidence for the authenticated owner');
select lives_ok(format($$select adopt_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64),%L,array['f9800000-0000-4000-8000-000000000301']::uuid[])$$,:'tenant'),'adoption retry does not run AI again');
reset role;
select is((select count(*) from usage_events where tenant_id=:'tenant' and feature='reception_assistance'),1::bigint,'adoption does not charge AI quota twice');
select is((select count(*) from external_photo_ai_attempts where tenant_id=:'tenant'),1::bigint,'one immutable owned evidence copy');
select is((select output->>'estimatedWeightG' from external_photo_ai_results where tenant_id=:'tenant'),'350','trusted weight survives sign-in');
update guest_photo_ai_attempts set created_at=now()-interval '25 hours' where tenant_id=:'tenant';
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select throws_like($$select read_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',repeat('b',64))$$,'%GUEST_ANALYSIS_EXPIRED%','capability expires after 24 hours');
select is(prune_guest_photo_analyses(),1,'hourly cleanup deletes expired guest data');
select throws_like(format($$select begin_guest_photo_analysis('f9800000-0000-4000-8000-000000000101',%L,repeat('b',64),repeat('c',64),repeat('d',64),array['f9800000-0000-4000-8000-000000000201']::uuid[],'sv','synthetic-model',now()-interval '25 hours')$$,:'tenant'),'%GUEST_ANALYSIS_EXPIRED%','expired client operation cannot silently run AI again after cleanup');
reset role;
select is((select count(*) from ai_credit_events where tenant_id=:'tenant' and kind='settled'),1::bigint,'cleanup retains immutable budget evidence');
select is((select output->>'estimatedWeightG' from external_photo_ai_results where tenant_id=:'tenant'),'350','cleanup retains explicitly adopted owned evidence');
select * from finish();
rollback;
