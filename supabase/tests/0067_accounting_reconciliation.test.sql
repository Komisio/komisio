begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000431','recon-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000432','recon-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000431","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Reconciliation test','recon-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','s@recon.test','')::text,true);
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper');
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',current_setting('test.agreement')::uuid)::text,true);
select set_config('test.d1',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d1')::uuid,0,'Jacket','Jackets','Good');
select set_config('test.i1',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i1')::uuid,'inspection_draft',current_setting('test.d1')::uuid,1,20000);
select set_config('test.d2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.d2')::uuid,0,'Coat','Coats','Good');
select set_config('test.i2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.i2')::uuid,'inspection_draft',current_setting('test.d2')::uuid,1,30000);
-- Day 1 (2026-09-01) sold and closed; day 2 (2026-09-02) sold and never closed; day 3 quiet.
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-1','2026-09-01T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i1'),'priceOre',20000)));
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','K-2','2026-09-02T10:00:00Z','SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.i2'),'priceOre',30000)));
select set_config('test.close',gen_random_uuid()::text,true);
select generate_day_close(current_setting('test.tenant')::uuid,current_setting('test.close')::uuid,'2026-09-01');
select set_config('test.r',accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-03')::text,true);
select is(jsonb_array_length(current_setting('test.r')::jsonb->'days'),2,'quiet days are left out');
select is(current_setting('test.r')::jsonb->'days'->0->>'status','not_exported','closed day without a map is not exported');
select is(current_setting('test.r')::jsonb->'days'->1->>'status','no_close','sold day without a close');
select is((current_setting('test.r')::jsonb->'counts'->>'no_close')::int,1,'counts per status');
select is((current_setting('test.r')::jsonb->>'mapVersion')::int,0,'no map yet');
-- Map, export: the day becomes not_sent; a new map makes the export outdated.
select set_config('test.m1',gen_random_uuid()::text,true);
select publish_accounting_map(current_setting('test.tenant')::uuid,current_setting('test.m1')::uuid,null,
 '{"grossOre":{"account":"1930","side":"debit"},"sellerCreditOre":{"account":"2890","side":"credit"},"commissionOre":{"account":"3010","side":"credit"},"commissionVatOre":{"account":"2610","side":"credit"}}');
select set_config('test.export',export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid)::text,true);
select is(accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')->'days'->0->>'status','not_sent','exported, not sent');
select set_config('test.m2',gen_random_uuid()::text,true);
select publish_accounting_map(current_setting('test.tenant')::uuid,current_setting('test.m2')::uuid,current_setting('test.m1')::uuid,
 '{"grossOre":{"account":"1930","side":"debit"},"sellerCreditOre":{"account":"2890","side":"credit"},"commissionOre":{"account":"3001","side":"credit"},"commissionVatOre":{"account":"2610","side":"credit"}}');
select is(accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')->'days'->0->>'status','export_outdated','the export predates the current map');
select set_config('test.export2',export_day_close(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.close')::uuid)::text,true);
-- Send outcomes: failed, then sent.
select set_config('test.cipher','{"iv":"aWl2","tag":"dGFn","data":"ZGF0YQ=="}',true);
select store_fortnox_connection(current_setting('test.tenant')::uuid,'1751085','Komisio Test','',current_setting('test.cipher')::jsonb,'',now()+interval '1 hour');
select set_config('test.s1',gen_random_uuid()::text,true);
select begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,current_setting('test.export2')::uuid);
select is(accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')->'days'->0->>'status','send_pending','send in progress');
select complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s1')::uuid,'failed','',null,null,'FORTNOX_PREFLIGHT_FAILED','');
select is(accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')->'days'->0->>'status','send_failed','failed send reported');
select is(accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')->'days'->0->'send'->>'errorCode','FORTNOX_PREFLIGHT_FAILED','with its preflight reason');
select set_config('test.s2',gen_random_uuid()::text,true);
select begin_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,current_setting('test.export2')::uuid);
select complete_fortnox_send(current_setting('test.tenant')::uuid,current_setting('test.s2')::uuid,'sent','A',8,2026,'','');
select set_config('test.r',accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')::text,true);
select is(current_setting('test.r')::jsonb->'days'->0->>'status','sent','sent day');
select is(current_setting('test.r')::jsonb->'days'->0->'send'->>'voucherNumber','8','voucher number carried');
-- Facts move after the close: a return makes the close stale.
select set_config('test.line1',(select l.id from sale_lines l join sales s on s.id=l.sale_id where s.tenant_id=current_setting('test.tenant')::uuid and s.external_id='K-1')::text,true);
select record_return(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.line1')::uuid,20000,'Changed mind','2026-09-01T15:00:00Z');
select is(accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-01')->'days'->0->>'status','close_stale','a return after the close makes it stale');
select throws_like($$select accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-03','2026-09-01')$$,'%INVALID_INPUT%','from after to refused');
select throws_like($$select accounting_reconciliation(current_setting('test.tenant')::uuid,'2020-01-01','2026-09-01')$$,'%INVALID_INPUT%','over a year refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000432","role":"authenticated"}';
select throws_ok($$select accounting_reconciliation(current_setting('test.tenant')::uuid,'2026-09-01','2026-09-03')$$,'42501',null,'outsider refused');
select * from finish();
rollback;
