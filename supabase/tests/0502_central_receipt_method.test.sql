begin;
select no_plan();
create function pg_temp.uid(n int) returns uuid language sql immutable as $$ select ('f5020000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.uid(1),'staff502@example.test',now()),(pg_temp.uid(2),'seller502@example.test',now());
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select create_tenant('Central 502','central-502',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant',pg_temp.uid(3),null,'Terms','Synthetic terms','sv',true);
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,(current_store_policy(:'tenant')->'policy')||'{"vatModeStoreOwned":"store_full"}'::jsonb);
reset role;
update platform_settings set central_app_tenant_id=:'tenant';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select save_central_intake_profile(pg_temp.uid(4),:'tenant',pg_temp.uid(3),-1,'{"street":"Test 1","postalCode":"12345","city":"Test"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',true);
select read_central_intake_profile()#>>'{account,sellerId}' as seller \gset
reset role;
select ok(not has_table_privilege('authenticated','komisio_private.central_payout_preferences','select'),'preference has no direct client reads');
set local role authenticated;
select ok(read_central_intake_profile()->'payoutPreference'='null'::jsonb,'shipping phone is not payment consent');
select throws_like(format('select save_central_payout_preference(%L,%L,%L,null,%L)',:'tenant',pg_temp.uid(999),pg_temp.uid(19),'{"method":"swish","phone":"+46700000001"}'),'%FORBIDDEN%','cannot set a different seller destination');
select reserve_external_item_photo(pg_temp.uid(5),repeat('b',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(5)||'.jpg');
select throws_like(format($$select submit_central_item_request(%L,%L,'Coat','','good','',60000,'SEK',array[%L]::uuid[],'SE','seller_amount',%L,'staff_decides')$$,pg_temp.uid(10),:'tenant',pg_temp.uid(5),pg_temp.uid(3)),'%PAYOUT_PREFERENCE_REQUIRED%','new items need a confirmed destination');
select is(save_central_payout_preference(:'tenant',:'seller',pg_temp.uid(6),null,'{"method":"swish","phone":"+46700000001"}'),pg_temp.uid(6),'confirm Swish once');
select is(save_central_payout_preference(:'tenant',:'seller',pg_temp.uid(6),null,'{"method":"swish","phone":"+46700000001"}'),pg_temp.uid(6),'retry preference safely');
select throws_like(format('select save_central_payout_preference(%L,%L,%L,null,%L)',:'tenant',:'seller',pg_temp.uid(18),'{"method":"swish","phone":"+46700000002"}'),'%PROFILE_CHANGED%','stale preference cannot overwrite a saved destination');
select submit_central_item_request(pg_temp.uid(n),:'tenant','Coat','','good','',60000,'SEK',array[pg_temp.uid(5)],'SE','seller_amount',pg_temp.uid(3),'staff_decides') from generate_series(10,11) n;
select ok(my_external_item_requests_page(0,pg_temp.uid(10),'all')#>>'{requests,0,sale_method}' is null,'no promise made on submission');
select is(my_external_item_requests_page(0,pg_temp.uid(10),'all')#>>'{requests,0,staff_selects_method}','true','recoverable immutable staff-selected instruction');
select throws_like(format('select confirm_central_receipt_consignment(%L,%L)',:'tenant',pg_temp.uid(10)),'%FORBIDDEN%','seller cannot choose terms for submitted item');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select approve_central_item_request(:'tenant',pg_temp.uid(20+n),pg_temp.uid(n),100000) from generate_series(10,11) n;
select throws_like(format('select confirm_central_receipt_consignment(%L,%L)',:'tenant',pg_temp.uid(10)),'%REQUEST_CHANGED%','cannot start guarantee before receipt');
select receive_handover(:'tenant',pg_temp.uid(40+n),(read_external_item_offer(pg_temp.uid(20+n))#>>'{handover,id}')::uuid,'staff_receipt','') from generate_series(10,11) n;
select ok(read_external_item_offer(pg_temp.uid(30))#>>'{guarantee,dueAt}' is null,'receipt awaits item inspection');
select confirm_central_receipt_consignment(:'tenant',pg_temp.uid(10)) as guarantee \gset
select is(confirm_central_receipt_consignment(:'tenant',pg_temp.uid(10)),:'guarantee'::uuid,'repeat uses same guarantee');
select is(read_external_item_offer(pg_temp.uid(30))->>'saleMethod','consignment','seller sees actual consignment');
select is((read_external_item_offer(pg_temp.uid(30))#>>'{guarantee,dueAt}')::timestamptz-(read_external_item_offer(pg_temp.uid(30))#>>'{handover,receivedAt}')::timestamptz,interval '1080 hours','guarantee starts on physical receipt');
select throws_like(format('select inspect_central_direct_purchase(%L,%L,%L,false)',:'tenant',pg_temp.uid(10),pg_temp.uid(60)),'%REQUEST_CHANGED%','cannot buy an item already consigned');
select inspect_central_direct_purchase(:'tenant',pg_temp.uid(11),pg_temp.uid(61),false);
select is(read_external_item_offer(pg_temp.uid(31))->>'saleMethod','direct_purchase','seller sees actual purchase');
select ok(read_external_item_offer(pg_temp.uid(31))->>'purchaseCreditedAt' is not null,'purchase credits once');
select throws_like(format('select confirm_central_receipt_consignment(%L,%L)',:'tenant',pg_temp.uid(11)),'%REQUEST_CHANGED%','purchased item cannot enter guarantee processing');
select is((select count(*) from public.payouts where tenant_id=:'tenant' and request_source='automatic' and amount_ore=60000 and status='requested'),1::bigint,'purchase creates one open request; no transfer');
select id as direct_payout from public.payouts where tenant_id=:'tenant' and request_source='automatic' \gset
select is(payout_bank_details(:'tenant',:'direct_payout')->>'swishPhone','+46700000001','staff sees confirmed number for this request');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select throws_like(format('select request_my_payout(%L,%L,%L,60000)',:'tenant',pg_temp.uid(80),:'seller'),'%PAYOUT_AUTOMATIC%','manual client cannot duplicate the automatic request');
select save_seller_bank_details(:'tenant',pg_temp.uid(70),:'seller',null,'{"holder":"Test","country":"SE","kind":"local","account":"123456789","routing":"1234"}');
select save_central_payout_preference(:'tenant',:'seller',pg_temp.uid(71),pg_temp.uid(6),jsonb_build_object('method','bank','bankVersionId',pg_temp.uid(70)));
select is(read_central_intake_profile()#>>'{payoutPreference,bankLastFour}','6789','seller sees masked bank destination');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
reset role;
select due_at as due from public.external_item_guarantees where id=:'guarantee' \gset
select ok(komisio_private.fulfill_due_guarantee(:'tenant',:'guarantee',:'due'),'day 45 credit queues the payout');
select ok(not komisio_private.fulfill_due_guarantee(:'tenant',:'guarantee',:'due'),'day 45 retry no-ops');
select is((select count(*) from public.payouts where tenant_id=:'tenant' and request_source='automatic' and status='requested'),2::bigint,'one request for each credited item');
select id as bank_payout from public.payouts where tenant_id=:'tenant' and id<>:'direct_payout' \gset
select is(payout_bank_details(:'tenant',:'bank_payout')#>>'{current,id}',pg_temp.uid(70)::text,'new automatic request pins newly selected bank');
select is(payout_bank_details(:'tenant',:'direct_payout')->>'swishPhone','+46700000001','later settings never redirect prior request');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select submit_central_item_request(pg_temp.uid(12),:'tenant','Dress','','good','',50000,'SEK',array[pg_temp.uid(5)],'SE','seller_amount',pg_temp.uid(3),'staff_decides');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select approve_central_item_request(:'tenant',pg_temp.uid(32),pg_temp.uid(12),100000);
select receive_handover(:'tenant',pg_temp.uid(52),(read_external_item_offer(pg_temp.uid(32))#>>'{handover,id}')::uuid,'staff_receipt','');
select confirm_central_receipt_consignment(:'tenant',pg_temp.uid(12)) as sold_guarantee \gset
select prepare_external_item_registration(:'tenant',:'sold_guarantee')->>'sessionId' as sale_session \gset
insert into storage.objects(bucket_id,name) select b,:'tenant'||'/'||:'sale_session'||'/'||pg_temp.uid(5)||'.jpg' from unnest(array['reception-photos','seller-reception-photos']) b;
select register_external_item(:'tenant',pg_temp.uid(85),:'sold_guarantee','Dress',100000) as item \gset
select record_sale(:'tenant',pg_temp.uid(86),'manual','sale-auto',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',30000)));
select is((select count(*) from public.payouts where tenant_id=:'tenant' and request_source='automatic' and amount_ore=50000),1::bigint,'customer sale queues agreed amount even below expected price');
select record_return(:'tenant',pg_temp.uid(87),(select id from sale_lines where sale_id=pg_temp.uid(86)),30000,'Return',clock_timestamp());
select is((select count(*) from public.payouts where tenant_id=:'tenant' and request_source='automatic'),3::bigint,'return does not repeat the payout');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select submit_central_item_request(pg_temp.uid(13),:'tenant','Skirt','','good','',45000,'SEK',array[pg_temp.uid(5)],'SE','seller_amount',pg_temp.uid(3),'staff_decides');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select approve_central_item_request(:'tenant',pg_temp.uid(33),pg_temp.uid(13),100000);
select receive_handover(:'tenant',pg_temp.uid(53),(read_external_item_offer(pg_temp.uid(33))#>>'{handover,id}')::uuid,'staff_receipt','');
select is(run_central_guarantees(:'tenant')->>'processed','0','a received item remains open before day 45');
reset role;
-- Exercise the deployed worker body with only its clock advanced in this transaction.
do $$ declare d text:=pg_get_functiondef('public.run_central_guarantees(uuid)'::regprocedure); begin
 execute replace(replace(d,'FUNCTION public.run_central_guarantees(','FUNCTION pg_temp.future_guarantees('),'at_time timestamptz:=clock_timestamp()','at_time timestamptz:=clock_timestamp()+interval ''45 days 1 minute''');
end $$;
select is(pg_temp.future_guarantees(:'tenant')->>'processed','1','unresolved physically received item enters the existing day-45 acquisition');
select is(pg_temp.future_guarantees(:'tenant')->>'processed','0','worker retry cannot repeat payout');
select is((select count(*) from payouts where tenant_id=:'tenant' and amount_ore=45000 and request_source='automatic' and status='requested'),1::bigint,'single open payout at deadline with no operator decision');
select * from finish();
rollback;
