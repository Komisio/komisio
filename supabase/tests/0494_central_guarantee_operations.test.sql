begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7400000-0000-4000-8000-000000000001','registration-staff@example.test',now(),null,null),
 ('f7400000-0000-4000-8000-000000000002','f7400000-0000-4000-8000-000000000002@example.test',now(),'46700007402',now()),
 ('f7400000-0000-4000-8000-000000000003','f7400000-0000-4000-8000-000000000003@example.test',now(),'46700007403',now()),
 ('f7400000-0000-4000-8000-000000000004','registration-reader@example.test',now(),null,null);
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('f7400000-0000-4000-8000-000000000005','guarantee-push-worker@example.test',now(),'{"komisio_push_worker":true}');
insert into auth.sessions(id,user_id,aal) values('f7400000-0000-4000-8000-000000000012','f7400000-0000-4000-8000-000000000002','aal1');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic offer recipient','synthetic-guaranteed-registration',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f7400000-0000-4000-8000-000000000101',null,'Synthetic agreement 1','Original synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f7400000-0000-4000-8000-000000000004','readonly');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f7400000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7400000-0000-4000-8000-000000000002/f7400000-0000-4000-8000-000000000201.jpg');
select submit_external_item_request('f7400000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',100000,'SEK',array['f7400000-0000-4000-8000-000000000201']::uuid[],'SE');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000002","session_id":"f7400000-0000-4000-8000-000000000012","role":"authenticated"}';
select set_my_push_device('f7400000-0000-4000-8000-000000000021',repeat('a',64),gen_random_uuid(),0,'ExpoPushToken[synthetic_guarantee]','ios','sv',true);

set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,(current_store_policy(:'tenant')->'policy')||'{"pushItemRegistered":true,"pushItemSold":true}');
select issue_external_item_offer(:'tenant','f7400000-0000-4000-8000-000000000401','f7400000-0000-4000-8000-000000000301',null,40000,100000,'f7400000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7400000-0000-4000-8000-000000000501','f7400000-0000-4000-8000-000000000401','f7400000-0000-4000-8000-000000000101','{"name":"Synthetic guarantee seller","email":"guarantee@example.test"}','{"holder":"Synthetic guarantee seller","country":"SE","kind":"local","routing":"8327","account":"123456789"}');
select handover_id as handover,seller_id as seller from external_item_handover_links where offer_id='f7400000-0000-4000-8000-000000000401' \gset
select is((select count(*) from external_item_guarantees),0::bigint,'accepting an offer does not start the guarantee clock');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select receive_handover(:'tenant','f7400000-0000-4000-8000-000000000601',:'handover','staff_receipt','') as bag \gset
select is((select count(*) from external_item_guarantees),1::bigint,'physical receipt freezes one guarantee');
select id as guarantee from external_item_guarantees where offer_id='f7400000-0000-4000-8000-000000000401' \gset
select publish_seller_agreement(:'tenant','f7400000-0000-4000-8000-000000000102','f7400000-0000-4000-8000-000000000101','Updated terms','These terms must not replace the accepted offer','sv',true);
select prepare_external_item_registration(:'tenant',:'guarantee')->>'sessionId' as session \gset
select is((select count(*) from items where tenant_id=:'tenant'),0::bigint,'preparing photos does not create inventory');
select throws_like(format($$select register_external_item(%L,'f7400000-0000-4000-8000-000000000801',%L,'Registered jacket',30000)$$,:'tenant',:'guarantee'),'%PHOTO_NOT_FOUND%','registration requires copied private photo evidence');
insert into storage.objects(bucket_id,name) values
 ('reception-photos',:'tenant'||'/'||:'session'||'/f7400000-0000-4000-8000-000000000201.jpg'),
 ('seller-reception-photos',:'tenant'||'/'||:'session'||'/f7400000-0000-4000-8000-000000000201.jpg');
select register_external_item(:'tenant','f7400000-0000-4000-8000-000000000801',:'guarantee','Registered jacket',30000) as item \gset

select is(record_sale(:'tenant','f7400000-0000-4000-8000-000000000901','manual','guarantee-first',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',30000))),'f7400000-0000-4000-8000-000000000901'::uuid,'manual sale below guarantee succeeds without selecting VAT');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','40000','seller gets exactly the fixed 400 SEK');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),1::bigint,'one fixed credit');
select ok((select guarantee_id=:'guarantee' and accounting_pending and vat_mode is null and vat_ore is null and commission_ore is null from sale_lines where sale_id='f7400000-0000-4000-8000-000000000901'),'accounting is explicitly pending, never invented zero VAT or commission');
select id as line from sale_lines where sale_id='f7400000-0000-4000-8000-000000000901' \gset
select record_return(:'tenant','f7400000-0000-4000-8000-000000000902',:'line',30000,'Synthetic customer return',clock_timestamp());
select is(seller_balance(:'tenant',:'seller')->>'availableOre','40000','customer return retains fixed credit');
select record_sale(:'tenant','f7400000-0000-4000-8000-000000000903','manual','guarantee-resale',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',80000)));
select is(seller_balance(:'tenant',:'seller')->>'availableOre','40000','resale above guarantee cannot credit twice');
select is((select seller_credit_ore from sale_lines where sale_id='f7400000-0000-4000-8000-000000000903'),0::bigint,'resale reports no second seller credit');
select is(economy_summary(:'tenant',current_date,current_date)#>>'{totals,grossOre}','110000','operational gross includes actual sale and resale prices');
select is(economy_summary(:'tenant',current_date,current_date)#>>'{totals,vatOre}',null::text,'unknown VAT is not displayed as zero');
select is(economy_summary(:'tenant',current_date,current_date)#>>'{totals,sellerCreditOre}','40000','period credits match actual retained balance');
select is(economy_summary(:'tenant',current_date,current_date)#>>'{sellerTypes,private,creditReversedOre}','0','seller-type report does not invent a reversal');
select is(stock_report_by_category(:'tenant',current_date,current_date,null)#>>'{total,marginOre}',null::text,'stock report leaves unknown margin unavailable');
select throws_like(format($$select generate_day_close(%L,gen_random_uuid(),current_date)$$,:'tenant'),'%GUARANTEE_ACCOUNTING_PENDING%','accounting document cannot be prepared from unresolved guarantee amounts');
select throws_like(format($$select issue_statement(%L,gen_random_uuid(),%L,current_date::timestamptz,clock_timestamp(),null)$$,:'tenant',:'seller'),'%GUARANTEE_ACCOUNTING_PENDING%','seller settlement cannot imply finalized commission or tax');
select is(run_central_guarantees(:'tenant')->>'processed','0','public worker cannot acquire a future or already credited item');
select is(record_sale(:'tenant','f7400000-0000-4000-8000-000000000901','manual','guarantee-first',(select occurred_at from sales where id='f7400000-0000-4000-8000-000000000901'),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',30000))),'f7400000-0000-4000-8000-000000000901'::uuid,'exact sale retry returns the original result');
select throws_like(format($$select record_sale(%L,gen_random_uuid(),'manual','duplicate',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',%L,'priceOre',30000)))$$,:'tenant',:'item'),'%ITEM_ALREADY_SOLD%','a new command cannot sell an already sold item');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_seller_accounts()#>>'{0,sellerId}',:'seller','central Auth owner discovers the existing seller without an email match');
select is(my_seller_payouts_page(:'tenant',:'seller',0)#>>'{balance,availableOre}','40000','existing mobile balance protocol reads central fixed credit');
select is(my_seller_payouts_page(:'tenant',:'seller',0)#>>'{balance,creditedOre}','40000','credited total includes the fixed amount');
select ok(read_external_item_offer('f7400000-0000-4000-8000-000000000401')#>>'{guarantee,creditedAt}' is not null,'unchanged app offer protocol exposes the fixed credit');
select throws_ok(format($$select run_central_guarantees(%L)$$,:'tenant'),'42501',null,'seller cannot run the guarantee worker');
select throws_ok(format($$select komisio_private.fulfill_due_guarantee(%L,%L,clock_timestamp()+interval '50 days')$$,:'tenant',:'guarantee'),'42501',null,'authenticated clients cannot supply an artificial expiry clock');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(format($$select run_central_guarantees(%L)$$,:'tenant'),'42501',null,'read-only staff cannot run expiry');
reset role;

-- Only the fixture uses the private clock argument. Receipt/offer evidence is
-- created through ordinary commands; no immutable production row is rewritten.
create function pg_temp.new_guarantee(t uuid,register_now boolean default false) returns uuid language plpgsql as $$
declare photo uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); offer uuid:=gen_random_uuid(); h uuid; g uuid; prepared jsonb;
begin
 perform set_config('request.jwt.claims','{"sub":"f7400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 perform reserve_external_item_photo(photo,repeat('b',64),100);
 insert into storage.objects(bucket_id,name) values('external-item-photos','f7400000-0000-4000-8000-000000000002/'||photo||'.jpg');
 perform submit_external_item_request(request,t,'Synthetic deadline item','','good','',null,'SEK',array[photo],'SE');
 perform set_config('request.jwt.claims','{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform issue_external_item_offer(t,offer,request,null,40000,100000,'f7400000-0000-4000-8000-000000000102');
 perform set_config('request.jwt.claims','{"sub":"f7400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 perform complete_external_item_offer(gen_random_uuid(),offer,'f7400000-0000-4000-8000-000000000102',null,null);
 select handover_id into h from external_item_handover_links where offer_id=offer;
 perform set_config('request.jwt.claims','{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform receive_handover(t,gen_random_uuid(),h,'staff_receipt','');
 select id into g from external_item_guarantees where offer_id=offer;
 if register_now then
  prepared:=prepare_external_item_registration(t,g);
  insert into storage.objects(bucket_id,name) values('reception-photos',t||'/'||(prepared->>'sessionId')||'/'||photo||'.jpg'),('seller-reception-photos',t||'/'||(prepared->>'sessionId')||'/'||photo||'.jpg');
  perform register_external_item(t,gen_random_uuid(),g,'Synthetic deadline item',100000);
 end if;
 return g;
end $$;
select pg_temp.new_guarantee(:'tenant') as due_guarantee \gset
select due_at as due,received_at as received from external_item_guarantees where id=:'due_guarantee' \gset
select is(komisio_private.fulfill_due_guarantee(:'tenant',:'due_guarantee',:'due'::timestamptz-interval '1 microsecond'),false,'one instant before day 45 gives no credit');
select is(komisio_private.fulfill_due_guarantee(:'tenant',:'due_guarantee',:'due'),true,'day 45 fulfills physically received but unregistered item');
select is(komisio_private.fulfill_due_guarantee(:'tenant',:'due_guarantee',:'due'::timestamptz+interval '1 day'),false,'repeated expiry is a no-op');
select is((select effective_at from external_item_guarantee_events where guarantee_id=:'due_guarantee' and kind='acquired'),:'due'::timestamptz,'ownership transfer retains the exact physical deadline');
select is((select occurred_at from seller_ledger_entries where reference_id=:'due_guarantee'),:'due'::timestamptz,'credit retains the exact deadline, separate from recorded time');
select is((select count(*) from purchase_receipts where tenant_id=:'tenant'),0::bigint,'operational acquisition invents no purchase or VAT document');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','80000','due amount joins the existing payout balance');
select is(economy_summary(:'tenant',(:'due'::timestamptz at time zone 'Europe/Stockholm')::date,(:'due'::timestamptz at time zone 'Europe/Stockholm')::date)#>>'{days,0,sellerCreditOre}','40000','a day with only guarantee credit appears without inventing sales');
select prepare_external_item_registration(:'tenant',:'due_guarantee')->>'sessionId' as due_session \gset
insert into storage.objects(bucket_id,name)
 select b,:'tenant'||'/'||:'due_session'||'/'||photo||'.jpg' from external_item_guarantees g
 join external_item_offers o on o.id=g.offer_id join external_item_requests r on r.id=o.request_id cross join unnest(r.photos) photo cross join unnest(array['reception-photos','seller-reception-photos']) b
 where g.id=:'due_guarantee';
select register_external_item(:'tenant',gen_random_uuid(),:'due_guarantee','Registered after credit',100000) as due_item \gset
select is(item_detail(:'tenant',:'due_item')#>>'{item,ownership}','store','registration after expiry derives store ownership without editing intake history');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','80000','later registration does not credit again');
select is((select received_at from external_item_guarantees where id=:'due_guarantee'),:'received'::timestamptz,'registration does not restart receipt clock');
select record_sale(:'tenant',gen_random_uuid(),'manual','late-fact',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'due_item','priceOre',50000)));
select ok((select reconciliation_required from external_item_guarantee_events where guarantee_id=:'due_guarantee' and kind='sold'),'late pre-deadline sale is recorded for reconciliation without rewriting acquisition');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','80000','late sale never pays the fixed amount twice');
select pg_temp.new_guarantee(:'tenant',true) as equal_guarantee \gset
select item_id as equal_item from external_item_guarantee_events where guarantee_id=:'equal_guarantee' and kind='registered' \gset
select record_sale(:'tenant',gen_random_uuid(),'manual','equal-price',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'equal_item','priceOre',40000)));
select is((select amount_ore from seller_ledger_entries where reference_id=:'equal_guarantee'),40000::bigint,'sale at the fixed amount credits exactly that amount');
select pg_temp.new_guarantee(:'tenant',true) as above_guarantee \gset
select item_id as above_item from external_item_guarantee_events where guarantee_id=:'above_guarantee' and kind='registered' \gset
select throws_like(format($$select record_sale(%L,gen_random_uuid(),'manual','future',clock_timestamp()+interval '1 day','SEK',jsonb_build_array(jsonb_build_object('itemId',%L,'priceOre',80000)))$$,:'tenant',:'above_item'),'%INVALID_INPUT%','future sale cannot move credit into the future');
select record_sale(:'tenant',gen_random_uuid(),'manual','above-price',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'above_item','priceOre',80000)));
select is((select amount_ore from seller_ledger_entries where reference_id=:'above_guarantee'),40000::bigint,'higher sale price still credits only the fixed amount');
select create_tenant('Other store','synthetic-guarantee-other',gen_random_uuid()) as other_tenant \gset
select throws_ok(format($$select run_central_guarantees(%L)$$,:'other_tenant'),'42501',null,'ordinary store cannot activate central guarantee worker');
set constraints all immediate;
select pass('all immutable financial evidence and deferred links validate');
select is((select count(*) from komisio_private.seller_push_deliveries where tenant_id=:'tenant' and kind='item_sold' and item_id=:'item'),1::bigint,'returned first sale is suppressed; resale queues one factual sale notice');
select id as push from komisio_private.seller_push_deliveries where tenant_id=:'tenant' and kind='item_sold' and item_id=:'item' \gset
set local role authenticated;
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(claim_seller_push(:'push','sv','Vara såld','Din vara har sålts.')->>'itemId',:'item','existing push worker can claim central seller sale without email matching');
select is(claim_seller_push(:'push','sv','Vara såld','Din vara har sålts.'),null::jsonb,'push claim retry never authorizes another send');
select is(central_guarantee_automation_tenants(),'[]'::jsonb,'push-worker identity alone grants no guarantee scope');
select throws_ok(format($$select run_central_guarantees(%L)$$,:'tenant'),'42501',null,'ungranted worker cannot fulfill guarantees');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(format($$select enable_automation(%L,gen_random_uuid(),'central_guarantees','guarantee-push-worker@example.test')$$,:'other_tenant'),'42501',null,'owner cannot grant central fulfillment for an ordinary store');
select enable_automation(:'tenant',gen_random_uuid(),'central_guarantees','guarantee-push-worker@example.test');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000005","role":"authenticated"}';
select accept_automation_grants();
select is(central_guarantee_automation_tenants()#>>'{0,tenantId}',:'tenant','accepted named scope exposes exactly the central store');
select is(jsonb_array_length(central_guarantee_automation_tenants()),1,'scope cannot enumerate other stores');
select is(run_central_guarantees(:'tenant')->>'processed','0','granted worker can run without duplicating fulfilled guarantees');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select disable_automation(:'tenant','central_guarantees');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok(format($$select run_central_guarantees(%L)$$,:'tenant'),'42501',null,'revoking the scope removes worker authority immediately');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f7400000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(format($$select run_central_guarantees(%L)$$,:'tenant'),'42501',null,'owner still needs required MFA');
reset role;
delete from auth.mfa_factors where user_id='f7400000-0000-4000-8000-000000000001';
select komisio_private.enable_billing('f7400000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
select close_store(:'tenant','Synthetic closure');
select throws_like(format($$select run_central_guarantees(%L)$$,:'tenant'),'%PLAN_READ_ONLY%','closed store does not bypass its plan boundary');
select * from finish(); rollback;
