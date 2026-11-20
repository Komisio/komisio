begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7300000-0000-4000-8000-000000000001','guarantee-staff@example.test',now(),null,null),
 ('f7300000-0000-4000-8000-000000000002','f7300000-0000-4000-8000-000000000002@example.test',now(),'46700007302',now()),
 ('f7300000-0000-4000-8000-000000000003','f7300000-0000-4000-8000-000000000003@example.test',now(),'46700007303',now()),
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
select submit_external_item_request('f7300000-0000-4000-8000-000000000301',:'tenant','Jacket','','good','',100000,'SEK',array['f7300000-0000-4000-8000-000000000201']::uuid[],'SE','seller_amount');

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
select is((select count(*) from external_item_guarantees),0::bigint,'another email owner cannot read guarantees');
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*) from external_item_guarantees),1::bigint,'authorized read-only staff can read guarantees');
reset role;
select throws_like(format($$update external_item_guarantees set amount_ore=1 where id=%L$$,:'guarantee'),'%IMMUTABLE%','accepted amount cannot be rewritten');
select throws_like(format($$delete from external_item_guarantees where id=%L$$,:'guarantee'),'%IMMUTABLE%','guarantee evidence cannot be deleted');
select is((select count(*) from items where tenant_id=:'tenant'),0::bigint,'receipt does not invent a registered item');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'receipt alone creates no seller credit');
select is((select count(*) from external_item_guarantee_events where tenant_id=:'tenant'),0::bigint,'no fabricated fulfillment events');
select is((select count(*) from purchase_receipts where tenant_id=:'tenant'),0::bigint,'receipt alone does not buy the item');
select is(komisio_private.external_request_state('f7300000-0000-4000-8000-000000000301',now()+interval '60 days'),'received','45 days passing alone never frees capacity');
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
select is(komisio_private.external_request_state('f7300000-0000-4000-8000-000000000301'),'registered','registered inventory retains its active slot');

insert into purchase_receipts(id,tenant_id,purchase_price_ore,evidence_reference,margin_eligible,created_by)
values('f7300000-0000-4000-8000-000000000730',:'tenant',40000,'Synthetic completed acquisition',true,'f7300000-0000-4000-8000-000000000001');
insert into external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,purchase_id,recorded_by)
values(gen_random_uuid(),:'tenant',:'guarantee','acquired','f7300000-0000-4000-8000-000000000701','f7300000-0000-4000-8000-000000000730','f7300000-0000-4000-8000-000000000001');
select is(komisio_private.external_request_state('f7300000-0000-4000-8000-000000000301'),'acquired','completed acquisition closes the request');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_external_item_requests()->>'activeCount','0','actual acquisition frees the active slot');
select is(my_external_item_requests_page(0,null,'history')#>>'{requests,0,lifecycleStatus}','acquired','acquired item remains visible in history');
reset role;
select * from finish();
rollback;
