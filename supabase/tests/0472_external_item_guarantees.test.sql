begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7300000-0000-4000-8000-000000000001','guarantee-staff@example.test',now(),null,null),
 ('f7300000-0000-4000-8000-000000000002',null,null,'46700007302',now()),
 ('f7300000-0000-4000-8000-000000000003',null,null,'46700007303',now()),
 ('f7300000-0000-4000-8000-000000000004','guarantee-reader@example.test',now(),null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic offer recipient','synthetic-guarantee-recipient',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f7300000-0000-4000-8000-000000000101',null,'Synthetic agreement 1','Original synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f7300000-0000-4000-8000-000000000004','readonly');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f7300000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f7300000-0000-4000-8000-000000000002/f7300000-0000-4000-8000-000000000201.jpg');
select submit_external_item_request('f7300000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',100000,'SEK',array['f7300000-0000-4000-8000-000000000201']::uuid[],'SE');

set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7300000-0000-4000-8000-000000000401','f7300000-0000-4000-8000-000000000301',null,40000,100000,'f7300000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f7300000-0000-4000-8000-000000000501','f7300000-0000-4000-8000-000000000401','f7300000-0000-4000-8000-000000000101','{"name":"Synthetic guarantee seller","email":"guarantee@example.test"}','{"holder":"Synthetic guarantee seller","country":"SE","kind":"local","routing":"8327","account":"123456789"}');
select handover_id as handover,seller_id as seller from external_item_handover_links where offer_id='f7300000-0000-4000-8000-000000000401' \gset
select is((select count(*) from external_item_guarantees),0::bigint,'accepting an offer does not start the guarantee clock');
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000001","role":"authenticated"}';
select receive_handover(:'tenant','f7300000-0000-4000-8000-000000000601',:'handover','staff_receipt','') as bag \gset
select is((select count(*) from external_item_guarantees),1::bigint,'physical receipt freezes one guarantee');
select id as guarantee from external_item_guarantees where offer_id='f7300000-0000-4000-8000-000000000401' \gset
select is((select amount_ore from external_item_guarantees where id=:'guarantee'),40000::numeric,'fixed compensation is copied from the accepted offer');
select is((select received_at from external_item_guarantees where id=:'guarantee'),(select received_at from seller_handovers where id=:'handover'),'clock starts at actual physical receipt');
select is((select due_at-received_at from external_item_guarantees where id=:'guarantee'),interval '1080 hours','deadline is exactly 45 days after receipt');
select is((select currency from external_item_guarantees where id=:'guarantee'),'SEK','guarantee retains SEK');
select lives_ok(format($$select receive_handover(%L,'f7300000-0000-4000-8000-000000000601',%L,'staff_receipt','')$$,:'tenant',:'handover'),'lost receipt responses replay successfully');
select is((select count(*) from external_item_guarantees),1::bigint,'receipt retry does not duplicate guarantees');
select throws_ok($$insert into external_item_guarantees(id) values(gen_random_uuid())$$,'42501',null,'staff cannot forge guarantees directly');
select throws_ok($$insert into external_item_guarantee_events(id) values(gen_random_uuid())$$,'42501',null,'staff cannot forge credit evidence directly');
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from external_item_guarantees),1::bigint,'verified owner can read own guarantee');
select is(read_external_item_offer('f7300000-0000-4000-8000-000000000401')#>>'{guarantee,amountOre}','40000','bounded offer read includes actual guarantee');
select is(read_external_item_offer('f7300000-0000-4000-8000-000000000401')#>>'{guarantee,creditedAt}',null::text,'a receipt is not represented as a credit');
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from external_item_guarantees),0::bigint,'another phone owner cannot read guarantees');
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*) from external_item_guarantees),1::bigint,'authorized read-only staff can read guarantees');
reset role;
select throws_like(format($$update external_item_guarantees set amount_ore=1 where id=%L$$,:'guarantee'),'%IMMUTABLE%','accepted amount cannot be rewritten');
select throws_like(format($$delete from external_item_guarantees where id=%L$$,:'guarantee'),'%IMMUTABLE%','guarantee evidence cannot be deleted');
select is((select count(*) from items where tenant_id=:'tenant'),0::bigint,'receipt does not invent a registered item');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'receipt alone creates no seller credit');
select is((select count(*) from external_item_guarantee_events where tenant_id=:'tenant'),0::bigint,'no fabricated fulfillment events');
select is((select count(*) from purchase_receipts where tenant_id=:'tenant'),0::bigint,'receipt alone does not buy the item');
-- Only this synthetic fixture bypasses the still-closed inventory entry point.
-- It exercises future fulfillment constraints without introducing a live sale API.
alter table public.items disable trigger guaranteed_item_intake;
insert into items(id,tenant_id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_by)
values('f7300000-0000-4000-8000-000000000701',:'tenant','reception_review','f7300000-0000-4000-8000-000000000702',1,'bag',
 (select received_bag_id from seller_handovers where id=:'handover'),:'seller','consignment','{}','f7300000-0000-4000-8000-000000000001');
set constraints all immediate;
alter table public.items enable trigger guaranteed_item_intake;
insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,recorded_by)
values('f7300000-0000-4000-8000-000000000703',:'tenant',:'guarantee','registered','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000001');
select throws_ok(format($$insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,recorded_by)
 values(gen_random_uuid(),%L,%L,'registered','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000001')$$,:'tenant',:'guarantee'),'23505',null,'one promise cannot register its item twice');
insert into sales(id,tenant_id,provider,external_id,currency,occurred_at,total_ore,recorded_by)
values('f7300000-0000-4000-8000-000000000710',:'tenant','manual','synthetic-guarantee-sale','SEK',now(),100000,'f7300000-0000-4000-8000-000000000001');
insert into sale_lines(id,tenant_id,sale_id,item_id,line_no,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore,vat_mode,vat_rate_bp,vat_basis,vat_ore,store_policy_version)
values('f7300000-0000-4000-8000-000000000711',:'tenant','f7300000-0000-4000-8000-000000000710','f7300000-0000-4000-8000-000000000701',1,100000,'consignment','inclusive',60,60000,0,40000,'consignment_margin',2500,'{}',12000,0);
insert into seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
values('f7300000-0000-4000-8000-000000000712',:'tenant',:'seller','credit_sale',40000,'sale_line','f7300000-0000-4000-8000-000000000711',now(),'f7300000-0000-4000-8000-000000000001');
insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,ledger_id,recorded_by)
values('f7300000-0000-4000-8000-000000000713',:'tenant',:'guarantee','credited','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000711','f7300000-0000-4000-8000-000000000712','f7300000-0000-4000-8000-000000000001');
select ok(read_external_item_offer('f7300000-0000-4000-8000-000000000401')#>>'{guarantee,creditedAt}' is not null,'credit time comes from actual linked ledger evidence');
select throws_like($$update external_item_guarantee_events set kind='sold' where id='f7300000-0000-4000-8000-000000000713'$$,'%IMMUTABLE%','credit evidence cannot be rewritten');
select throws_like($$delete from external_item_guarantee_events where id='f7300000-0000-4000-8000-000000000713'$$,'%IMMUTABLE%','credit evidence cannot be removed to allow a second credit');
insert into sale_returns(id,tenant_id,sale_line_id,item_id,refund_ore,reason,occurred_at,recorded_by)
values('f7300000-0000-4000-8000-000000000714',:'tenant','f7300000-0000-4000-8000-000000000711','f7300000-0000-4000-8000-000000000701',100000,'Synthetic customer return',now(),'f7300000-0000-4000-8000-000000000001');
insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,return_id,recorded_by)
values('f7300000-0000-4000-8000-000000000715',:'tenant',:'guarantee','returned','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000711','f7300000-0000-4000-8000-000000000714','f7300000-0000-4000-8000-000000000001');
select is((select count(*) from external_item_guarantee_events where guarantee_id=:'guarantee' and kind='credited'),1::bigint,'return evidence retains the original fulfillment');
-- A later sale has a different sale-line identity: uniqueness is per promise,
-- not merely a duplicate of the first transaction's source reference.
insert into sales(id,tenant_id,provider,external_id,currency,occurred_at,total_ore,recorded_by)
values('f7300000-0000-4000-8000-000000000720',:'tenant','manual','synthetic-guarantee-resale','SEK',now(),100000,'f7300000-0000-4000-8000-000000000001');
insert into sale_lines(id,tenant_id,sale_id,item_id,line_no,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore,vat_mode,vat_rate_bp,vat_basis,vat_ore,store_policy_version)
values('f7300000-0000-4000-8000-000000000721',:'tenant','f7300000-0000-4000-8000-000000000720','f7300000-0000-4000-8000-000000000701',1,100000,'consignment','inclusive',60,60000,0,40000,'consignment_margin',2500,'{}',12000,0);
insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,recorded_by)
values('f7300000-0000-4000-8000-000000000722',:'tenant',:'guarantee','sold','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000721','f7300000-0000-4000-8000-000000000001');
select throws_ok(format($test$do $body$ begin
 insert into seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
 values('f7300000-0000-4000-8000-000000000716',%L,%L,'credit_sale',40000,'sale_line','f7300000-0000-4000-8000-000000000721',now(),'f7300000-0000-4000-8000-000000000001');
 insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,ledger_id,recorded_by)
 values(gen_random_uuid(),%L,%L,'credited','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000721','f7300000-0000-4000-8000-000000000716','f7300000-0000-4000-8000-000000000001');
 end $body$;$test$,:'tenant',:'seller',:'tenant',:'guarantee'),'23505',null,'return does not permit another credit and an atomic retry rolls back');
select is((select count(*) from seller_ledger_entries where id='f7300000-0000-4000-8000-000000000716'),0::bigint,'failed duplicate fulfillment leaves no additional ledger row');
select is((select sum(amount_ore) from seller_ledger_entries where tenant_id=:'tenant' and seller_id=:'seller'),40000::numeric,'linking a return and resale leaves the one fixed credit intact');
insert into auth.mfa_factors(id,created_at,updated_at,user_id,status,factor_type,friendly_name) values(gen_random_uuid(),now(),now(),'f7300000-0000-4000-8000-000000000002','verified','totp','Synthetic guarantee MFA');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from external_item_guarantees),0::bigint,'MFA downgrade hides guarantees');
select is((select count(*) from external_item_guarantee_events),0::bigint,'MFA downgrade hides fulfillment evidence');
select throws_ok($$select read_external_item_offer('f7300000-0000-4000-8000-000000000401')$$,'42501',null,'MFA downgrade cannot read guarantee through the offer API');
reset role;
select * from finish();
rollback;
