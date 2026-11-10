begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7400000-0000-4000-8000-000000000001','registration-staff@example.test',now(),null,null),
 ('f7400000-0000-4000-8000-000000000002',null,null,'46700007402',now()),
 ('f7400000-0000-4000-8000-000000000003',null,null,'46700007403',now()),
 ('f7400000-0000-4000-8000-000000000004','registration-reader@example.test',now(),null,null);
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

set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000001","role":"authenticated"}';
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
select is((select count(*) from items where tenant_id=:'tenant'),1::bigint,'registration creates exactly one inventory record');
select is((select terms->>'agreementVersionId' from items where id=:'item'),'f7400000-0000-4000-8000-000000000101','registration keeps the accepted old agreement');
select is((select terms#>>'{externalGuarantee,amountOre}' from items where id=:'item'),'40000','a lower selling price does not change the guarantee');
select is((select price_ore from item_prices where item_id=:'item'),30000::bigint,'staff may set the actual price below the fixed guarantee');
select ok((select not(terms ? 'commissionRatePercent') and not(terms ? 'consignmentPeriod') from items where id=:'item'),'ordinary percentage and calendar terms do not enter guaranteed inventory');
select is((select kind from external_item_guarantee_events where guarantee_id=:'guarantee'),'registered','registration is linked by an immutable event');
select is((select terms#>>'{externalGuarantee,dueAt}' from items where id=:'item'),(select to_jsonb(due_at)#>>'{}' from external_item_guarantees where id=:'guarantee'),'registration cannot restart the receipt clock');
select is(register_external_item(:'tenant','f7400000-0000-4000-8000-000000000801',:'guarantee','Registered jacket',30000),:'item'::uuid,'a lost response replays the same item');
select throws_like(format($$select register_external_item(%L,'f7400000-0000-4000-8000-000000000801',%L,'Changed retry',30000)$$,:'tenant',:'guarantee'),'%REQUEST_CONFLICT%','changed retry cannot overwrite the item');
select throws_like(format($$select register_external_item(%L,gen_random_uuid(),%L,'Duplicate',30000)$$,:'tenant',:'guarantee'),'%REQUEST_CHANGED%','a second command cannot register the same guarantee');
select throws_like(format($$select end_sale_period(%L,gen_random_uuid(),%L,'charity','')$$,:'tenant',:'item'),'%GUARANTEED_LIFECYCLE_REQUIRED%','ordinary charity cannot dispose of a guaranteed item');
select throws_like(format($$select extend_sale_period(%L,gen_random_uuid(),%L,10,'Synthetic extension')$$,:'tenant',:'item'),'%GUARANTEED_LIFECYCLE_REQUIRED%','ordinary extensions cannot move the guarantee deadline');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'registration does not credit or charge the seller');
select is(items_search_page(:'tenant','{}','title','asc',25,0)->>'total','1','registered item remains readable in the ordinary inventory');
select is(items_search_page(:'tenant','{}','title','asc',25,0)#>>'{items,0,photoCount}','1','inventory includes the copied original photo');
select is(items_search_page(:'tenant','{}','title','asc',25,0)#>>'{items,0,paypal,canExport}','false','percentage-based POS preparation remains unavailable');
reset role;
select is(komisio_private.item_lifecycle(:'tenant',:'item')->>'periodEnd',(select to_jsonb(due_at)#>>'{}' from external_item_guarantees where id=:'guarantee'),'the ordinary item projection uses the physical guarantee deadline');
select is(komisio_private.item_lifecycle(:'tenant',:'item')->>'endOfPeriodAction',null::text,'ordinary lifecycle cannot offer charity or seller collection');
select throws_like(format($$select komisio_private.sale_line_facts(%L,%L,30000,'{}')$$,:'tenant',:'item'),'%GUARANTEED_SALE_REQUIRED%','percentage sale accounting cannot execute a guaranteed sale');
set constraints all immediate;
select pass('the registration and immutable guarantee link satisfy deferred constraints');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(format($$select prepare_external_item_registration(%L,%L)$$,:'tenant',:'guarantee'),'42501',null,'phone owner cannot register inventory');
select is(read_external_item_offer('f7400000-0000-4000-8000-000000000401')#>>'{guarantee,itemId}',:'item','owner can read actual registered-item evidence');
set local request.jwt.claims='{"sub":"f7400000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(format($$select prepare_external_item_registration(%L,%L)$$,:'tenant',:'guarantee'),'42501',null,'read-only staff cannot prepare inventory');
select * from finish();
rollback;
