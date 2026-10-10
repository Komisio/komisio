begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000002911','pricing-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000002912','pricing-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000002913','pricing-admin@example.test',now()),
 ('f0000000-0000-4000-8000-000000002914','pricing-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002911","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Pricing follow-up','pricing-follow-up',gen_random_uuid())::text,true);
select set_config('test.other',create_tenant('Other pricing store','other-pricing-store',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Private synthetic name','private-synthetic@example.test','')::text,true);
select set_config('test.nok',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"currency":"NOK","vatModeConsignmentPrivate":"consignment_margin"}')::text,true);
select set_config('test.policy',publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.nok')::uuid,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"currency":"SEK"}')::text,true);
select set_config('test.profile',publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'{"address":{"street":"","postalCode":"","city":"","country":"SE"},"contact":{"email":"","phone":"","website":""},"openingHours":[],"accepts":"","concept":"","language":"sv"}')::text,true);
reset role;
-- Historical synthetic fixtures: no provider, photo upload or customer data.
create function pg_temp.pricing_fixture(kind text) returns uuid language plpgsql security definer as $$
declare t uuid:=current_setting('test.tenant')::uuid; seller uuid:=current_setting('test.seller')::uuid;
 actor uuid:='f0000000-0000-4000-8000-000000002911'; a uuid:=gen_random_uuid(); submission uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); sale uuid;
 output jsonb; at_time timestamptz:='2026-09-01T10:00:00Z'; accepted timestamptz:='2026-09-05T10:00:00Z';
begin
 if kind='late' then at_time:='2026-09-06T10:00:00Z'; end if;
 if kind='outside' then accepted:='2026-08-31T10:00:00Z'; at_time:='2026-08-30T10:00:00Z'; end if;
 output:='{"description":"Private synthetic description","price":null,"suitability":"uncertain","reason":"Private synthetic reason","approximatePrice":{"from":"150.01","to":"250.01","basis":"ai_estimate"}}';
 if kind='no_price' then output:=output-'approximatePrice'; end if;
 if kind='web' then output:=output-'approximatePrice'||'{"externalComparison":{"from":"160.00","to":"200.00","basis":"asking"}}'; end if;
 if kind='store' then output:=output||'{"price":{"from":"180.00","to":"220.00","evidenceIds":[]}}'; end if;
 if kind<>'no_assessment' then
  insert into public.seller_ai_attempts(id,tenant_id,seller_id,photos,context,model,created_by,created_at)
   values(a,t,seller,'["private-photo.jpg"]',jsonb_build_object('country',case when kind='german' then 'DE' else 'SE' end,'currency','SEK'),'synthetic',actor,at_time-interval '1 minute');
  insert into public.seller_ai_results(id,tenant_id,output,created_at) values(a,t,output,at_time);
 else a:=null; end if;
 insert into public.seller_submissions(id,tenant_id,seller_id,description,photos,created_by,created_at,assistance_id,assistance_output,price_currency)
  values(submission,t,seller,'Private synthetic description','["private-photo.jpg"]',actor,at_time+interval '1 minute',a,case when a is not null then jsonb_build_object('suggestion',output,'currency','SEK') end,'SEK');
 perform public.create_reception_session(t,session,seller);
 insert into public.submission_receptions(tenant_id,submission_id,session_id,created_by) values(t,submission,session,actor);
 if kind='not_received' then return item; end if;
 insert into public.items(id,tenant_id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_by,accepted_at)
  values(item,t,'reception_review',session,1,'garment',gen_random_uuid(),seller,'consignment',jsonb_build_object('commissionBasis','inclusive','commissionRatePercent',40,'storePolicyId',case when kind='currency' then current_setting('test.nok') else current_setting('test.policy') end,'storePolicyVersion',2),actor,accepted);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by,set_at) values(t,item,20001,'accepted',actor,accepted);
 if kind in ('sold','returned') then
  sale:=public.record_sale(t,gen_random_uuid(),'manual','synthetic-'||item,'2026-09-07T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',item,'priceOre',16001)));
  if kind='returned' then perform public.record_return(t,gen_random_uuid(),(select id from public.sale_lines where sale_id=sale),16001,'Synthetic return','2026-09-08T10:00:00Z'); end if;
 end if;
 return item;
end $$;
create temp table pricing_fx(kind text,id uuid);
insert into pricing_fx select k,pg_temp.pricing_fixture(k) from unnest(array['sold','unsold','no_price','no_assessment','german','currency','late','returned','outside','not_received','web','store']) k;
set local role authenticated;
select set_config('test.report',pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')::text,true);
select is((current_setting('test.report')::jsonb->>'receivedItems')::int,10,'only physically accepted linked items within the window');
select is(current_setting('test.report')::jsonb->>'marketCountry','SE','current store market is explicit');
select is(current_setting('test.report')::jsonb->>'currency','SEK','current store currency is explicit');
select is((current_setting('test.report')::jsonb->>'withoutAssessment')::int,1,'missing saved assessment counted separately');
select is((current_setting('test.report')::jsonb->>'otherMarketOrCurrency')::int,2,'historical market and accepted currency never mixed');
select is((current_setting('test.report')::jsonb->>'invalidTiming')::int,1,'hindsight assessment counted');
select is(jsonb_array_length(current_setting('test.report')::jsonb->'cohort'->'observations'),7,'eligible cohort retains missing prices and unsold goods');
reset role;
grant select on pricing_fx to authenticated;
set local role authenticated;
select is((select x->'prediction'->>'lowOre' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='sold')),'15001','exact minor units from original saved estimate');
select is((select x->'staffDecision'->>'priceOre' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='sold')),'20001','original accepted price');
select is((select x->'sale'->>'priceOre' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='sold')),'16001','actual sale price');
select is((select x->'sale' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='unsold')),'null'::jsonb,'unsold is not zero or successful prediction');
select is((select x->'prediction' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='no_price')),'null'::jsonb,'absent estimate retained');
select is((select x->'prediction' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='late')),'null'::jsonb,'hindsight cannot appear as a prediction');
select is((select x->'sale'->>'returned' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='returned')),'true','returns retained for evaluator exclusion');
select is((select x->'prediction'->>'basis' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='web')),'web','external comparisons separate from model estimates');
select is((select x->'prediction'->>'basis' from jsonb_array_elements(current_setting('test.report')::jsonb->'cohort'->'observations') x where x->>'itemId'=(select id::text from pricing_fx where kind='store')),'store_sales','store evidence takes the same precedence as displayed estimate');
select ok(current_setting('test.report') not like '%Private synthetic%' and current_setting('test.report') not like '%private-photo%' and current_setting('test.report') not like '%@example.test%','no names, free text, photos or contact details');
select is(pricing_follow_up(current_setting('test.other')::uuid,'2026-09-01','2026-09-30')->'cohort','null'::jsonb,'another owned store stays empty');
select is(pricing_follow_up(current_setting('test.tenant')::uuid,'2026-07-01','2026-07-31')->>'receivedItems','0','empty period');
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-30','2026-09-01')$$,'%INVALID_INPUT%','reversed dates refused');
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2024-01-01','2026-09-30')$$,'%INVALID_INPUT%','bounded period');
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,null,'2026-09-30')$$,'%INVALID_INPUT%','null date refused');
select set_config('test.changed_profile',publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.profile')::uuid,jsonb_set(current_store_profile(current_setting('test.tenant')::uuid)->'profile','{address,country}','"DE"'))::text,true);
select is(jsonb_array_length(pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')->'cohort'->'observations'),1,'changing current market never relabels saved Swedish assessments as German');
select publish_store_profile(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.changed_profile')::uuid,jsonb_set(current_store_profile(current_setting('test.tenant')::uuid)->'profile','{address,country}','"SE"'));
reset role;
-- A busy cohort must fail visibly rather than report only a convenient first page.
create temp table pricing_bulk as select gen_random_uuid() submission,gen_random_uuid() session,gen_random_uuid() item from generate_series(1,5001);
insert into public.reception_sessions(id,tenant_id,seller_id,created_by)
 select session,current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'f0000000-0000-4000-8000-000000002911' from pricing_bulk;
insert into public.seller_submissions(id,tenant_id,seller_id,description,photos,created_by)
 select submission,current_setting('test.tenant')::uuid,current_setting('test.seller')::uuid,'Synthetic bounded cohort','["private-photo.jpg"]','f0000000-0000-4000-8000-000000002911' from pricing_bulk;
insert into public.submission_receptions(tenant_id,submission_id,session_id,created_by)
 select current_setting('test.tenant')::uuid,submission,session,'f0000000-0000-4000-8000-000000002911' from pricing_bulk;
insert into public.items(id,tenant_id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_by,accepted_at)
 select item,current_setting('test.tenant')::uuid,'reception_review',session,1,'garment',gen_random_uuid(),current_setting('test.seller')::uuid,'consignment','{}','f0000000-0000-4000-8000-000000002911','2026-06-05T10:00:00Z' from pricing_bulk;
set local role authenticated;
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2026-06-01','2026-06-30')$$,'%PERIOD_TOO_LARGE%','more than 5000 received goods require a smaller period');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002912','staff'),
 (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000002913','admin');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002912","role":"authenticated"}';
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')$$,'%FORBIDDEN%','ordinary staff cannot export evaluation cohort');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002913","role":"authenticated"}';
select lives_ok($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')$$,'admin allowed');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002914","role":"authenticated"}';
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')$$,'%FORBIDDEN%','outsider denied');
reset role;
select ok(not has_function_privilege('anon','public.pricing_follow_up(uuid,date,date)','execute'),'anonymous denied');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000002911','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000002911","role":"authenticated","aal":"aal1"}';
select throws_like($$select pricing_follow_up(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-30')$$,'%AUTH_REQUIRED%','MFA applies to export');
reset role;
select * from finish(); rollback;
