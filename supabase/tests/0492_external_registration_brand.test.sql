begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f4920000-0000-4000-8000-000000000001','registration-staff@example.test',now(),null,null),
 ('f4920000-0000-4000-8000-000000000002','f4920000-0000-4000-8000-000000000002@example.test',now(),'46700007402',now()),
 ('f4920000-0000-4000-8000-000000000003','f4920000-0000-4000-8000-000000000003@example.test',now(),'46700007403',now()),
 ('f4920000-0000-4000-8000-000000000004','registration-reader@example.test',now(),null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"f4920000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic offer recipient','synthetic-branded-registration',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f4920000-0000-4000-8000-000000000101',null,'Synthetic agreement 1','Original synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f4920000-0000-4000-8000-000000000004','readonly');
set local role authenticated;
set local request.jwt.claims='{"sub":"f4920000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f4920000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f4920000-0000-4000-8000-000000000002/f4920000-0000-4000-8000-000000000201.jpg');
select submit_external_item_request('f4920000-0000-4000-8000-000000000301',:'tenant','Backpack','Example brand','good','',100000,'SEK',array['f4920000-0000-4000-8000-000000000201']::uuid[],'SE');

set local request.jwt.claims='{"sub":"f4920000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f4920000-0000-4000-8000-000000000401','f4920000-0000-4000-8000-000000000301',null,40000,100000,'f4920000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f4920000-0000-4000-8000-000000000002","role":"authenticated"}';
select complete_external_item_offer('f4920000-0000-4000-8000-000000000501','f4920000-0000-4000-8000-000000000401','f4920000-0000-4000-8000-000000000101','{"name":"Synthetic guarantee seller","email":"guarantee@example.test"}','{"holder":"Synthetic guarantee seller","country":"SE","kind":"local","routing":"8327","account":"123456789"}');
select handover_id as handover,seller_id as seller from external_item_handover_links where offer_id='f4920000-0000-4000-8000-000000000401' \gset
select is((select count(*) from external_item_guarantees),0::bigint,'accepting an offer does not start the guarantee clock');
set local request.jwt.claims='{"sub":"f4920000-0000-4000-8000-000000000001","role":"authenticated"}';
select receive_handover(:'tenant','f4920000-0000-4000-8000-000000000601',:'handover','staff_receipt','') as bag \gset
select is((select count(*) from external_item_guarantees),1::bigint,'physical receipt freezes one guarantee');
select id as guarantee from external_item_guarantees where offer_id='f4920000-0000-4000-8000-000000000401' \gset
select publish_seller_agreement(:'tenant','f4920000-0000-4000-8000-000000000102','f4920000-0000-4000-8000-000000000101','Updated terms','These terms must not replace the accepted offer','sv',true);
select prepare_external_item_registration(:'tenant',:'guarantee')->>'sessionId' as session \gset
select is((select count(*) from items where tenant_id=:'tenant'),0::bigint,'preparing photos does not create inventory');
select throws_like(format($$select register_external_item(%L,'f4920000-0000-4000-8000-000000000801',%L,'Registered jacket',30000)$$,:'tenant',:'guarantee'),'%PHOTO_NOT_FOUND%','registration requires copied private photo evidence');
insert into storage.objects(bucket_id,name) values
 ('reception-photos',:'tenant'||'/'||:'session'||'/f4920000-0000-4000-8000-000000000201.jpg'),
 ('seller-reception-photos',:'tenant'||'/'||:'session'||'/f4920000-0000-4000-8000-000000000201.jpg');
select lives_ok(format($$select register_external_item(%L,'f4920000-0000-4000-8000-000000000801',%L,'Checked backpack',60000)$$,:'tenant',:'guarantee'),'a submitted brand does not block central registration');
select is((select brand from external_item_requests where id='f4920000-0000-4000-8000-000000000301'),'Example brand','original unverified brand remains in request evidence');
select is((select count(*) from items where tenant_id=:'tenant'),1::bigint,'registration creates exactly one item');
select is((select suggestions->'attributes'->0->>'value' from reception_reviews where session_id=:'session'),'Checked backpack','staff-confirmed description reaches the review');
select is((select jsonb_array_length(suggestions->'attributes') from reception_reviews where session_id=:'session'),1,'unverified brand is not promoted to an observed attribute');
select is((select suggestions->'attributes'->0->>'certainty' from reception_reviews where session_id=:'session'),'observed','description retains staff-confirmed provenance');
select is((select price_ore from item_prices where tenant_id=:'tenant'),60000::bigint,'registration retains the confirmed selling price');
select is((select terms#>>'{externalGuarantee,amountOre}' from items where tenant_id=:'tenant'),'40000','accepted fixed amount is unchanged');
select is((select terms#>>'{externalGuarantee,dueAt}' from items where tenant_id=:'tenant'),(select to_jsonb(due_at)#>>'{}' from external_item_guarantees where id=:'guarantee'),'physical receipt still sets the original deadline');
select is((select terms->>'agreementVersionId' from items where tenant_id=:'tenant'),'f4920000-0000-4000-8000-000000000101','accepted agreement is retained after a newer version is published');
select lives_ok(format($$select register_external_item(%L,'f4920000-0000-4000-8000-000000000801',%L,'Checked backpack',60000)$$,:'tenant',:'guarantee'),'same command can be retried after success');
select is((select count(*) from external_item_guarantee_events where guarantee_id=:'guarantee' and kind='registered'),1::bigint,'retry does not duplicate the registration');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'registration does not create a financial credit');
select is(items_search_page(:'tenant','{}','title','asc',25,0)#>>'{items,0,photoCount}','1','the registered item keeps its copied photo');
set constraints all immediate;
select * from finish();
rollback;
