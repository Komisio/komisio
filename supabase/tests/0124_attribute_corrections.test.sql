begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000c01','corr-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000c02','corr-readonly@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c01","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Correction store','corr-test',gen_random_uuid())::text,true);
select create_invitation(current_setting('test.tenant')::uuid,'corr-readonly@example.test','readonly',repeat('e',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c02","role":"authenticated"}';
select accept_invitation(repeat('e',64));
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c01","role":"authenticated"}';
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','','1')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_margin","vatRatePercent":25}');
-- A sweater received as size M.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Blue wool sweater','Tröjor','Good, size M');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000);
select set_config('test.origin',(select origin_revision from items where id=current_setting('test.item')::uuid)::text,true);

-- Before any correction, every value is what was accepted.
select is((select a->>'source' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='condition'),'accepted','an uncorrected value is marked as accepted');

-- Two weeks later the label says L.
select set_config('test.c1',gen_random_uuid()::text,true);
select is(correct_item_attribute(current_setting('test.tenant')::uuid,current_setting('test.c1')::uuid,current_setting('test.item')::uuid,'size','L','Label read at the counter')->>'value','L','staff correct the size');
select set_config('test.read',item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)::text,true);
select is((select a->>'value' from jsonb_array_elements(current_setting('test.read')::jsonb) a where a->>'slug'='size'),'L','the shelf shows the corrected size');
select is((select a->>'source' from jsonb_array_elements(current_setting('test.read')::jsonb) a where a->>'slug'='size'),'corrected','and says that it was corrected');
select is((select a->>'reason' from jsonb_array_elements(current_setting('test.read')::jsonb) a where a->>'slug'='size'),'Label read at the counter','with the reason it was corrected for');

-- The evidence is untouched: the item still points at what the seller approved.
select is((select origin_revision from items where id=current_setting('test.item')::uuid)::text,current_setting('test.origin'),'a correction never moves the item to another revision');
select is((select description from inspection_draft_revisions where draft_id=current_setting('test.draft')::uuid and revision=1),'Blue wool sweater','and never edits the evidence it was accepted on');

-- Correcting something the reception recorded keeps the accepted value beside it.
select set_config('test.c2',gen_random_uuid()::text,true);
select correct_item_attribute(current_setting('test.tenant')::uuid,current_setting('test.c2')::uuid,current_setting('test.item')::uuid,'condition','Good, small hole at the left cuff','Found on closer inspection');
select is((select a->'accepted'->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='condition'),'Good, size M','what the seller approved is still readable beside the correction');

-- A later correction of the same attribute wins, and both rows survive.
select set_config('test.c3',gen_random_uuid()::text,true);
select correct_item_attribute(current_setting('test.tenant')::uuid,current_setting('test.c3')::uuid,current_setting('test.item')::uuid,'size','XL','Measured');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='size'),'XL','the latest correction wins');
select is((select count(*) from item_attribute_corrections where item_id=current_setting('test.item')::uuid and slug='size'),2::bigint,'and the earlier one is still recorded');

-- A retry of the same correction is the same correction.
select is(correct_item_attribute(current_setting('test.tenant')::uuid,current_setting('test.c3')::uuid,current_setting('test.item')::uuid,'size','XL','Measured')->>'replayed','true','a retry returns the correction it already made');
select is((select count(*) from item_attribute_corrections where item_id=current_setting('test.item')::uuid and slug='size'),2::bigint,'and records nothing new');
select throws_like($$select correct_item_attribute(current_setting('test.tenant')::uuid,current_setting('test.c3')::uuid,current_setting('test.item')::uuid,'size','XXL','Measured')$$,'%REQUEST_CONFLICT%','the same id with a different value is a conflict');

-- Corrections are new rows, never edits.
select throws_like($$update item_attribute_corrections set value='S' where id=current_setting('test.c1')::uuid$$,'%','a correction cannot be edited');
select throws_like($$delete from item_attribute_corrections where id=current_setting('test.c1')::uuid$$,'%','and cannot be deleted');

-- Refusals: a reason is required, the vocabulary still bounds the slugs, and
-- the item must be the store's own.
select throws_like($$select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,'size','L','')$$,'%INVALID_INPUT%','a correction without a reason is refused');
select throws_like($$select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,'impedance','8','Measured')$$,'%ATTRIBUTE_UNDEFINED%','an attribute nobody defined is refused');
select throws_like($$select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),gen_random_uuid(),'size','L','Measured')$$,'%ITEM_NOT_FOUND%','an unknown item is refused');

-- A correction may add what the reception never recorded.
select set_config('test.c4',gen_random_uuid()::text,true);
select correct_item_attribute(current_setting('test.tenant')::uuid,current_setting('test.c4')::uuid,current_setting('test.item')::uuid,'brand','Filippa K','Label found inside');
select is((select a->>'value' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='brand'),'Filippa K','an attribute the reception missed can be added');
select is((select a->'accepted' from jsonb_array_elements(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid)) a where a->>'slug'='brand'),'null'::jsonb,'and has no accepted value, because none was approved');

-- Reading is for members; correcting is for staff and above.
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000c02","role":"authenticated"}';
select ok(jsonb_array_length(item_attribute_list(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid))>0,'a readonly member reads the corrected list');
select throws_ok($$select correct_item_attribute(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item')::uuid,'size','S','Guess')$$,'42501',null,'and cannot correct');
select * from finish();
rollback;
