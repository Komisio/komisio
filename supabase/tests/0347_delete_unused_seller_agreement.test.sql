begin;
\ir bag-reception-fixture.inc
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('49000000-0000-4000-8000-000000000001','agreement-delete-owner@example.test',now()),
 ('49000000-0000-4000-8000-000000000002','agreement-delete-staff@example.test',now()),
 ('49000000-0000-4000-8000-000000000003','agreement-delete-reader@example.test',now()),
 ('49000000-0000-4000-8000-000000000004','agreement-delete-admin@example.test',now()),
 ('49000000-0000-4000-8000-000000000005','agreement-delete-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Agreement delete','agreement-delete',gen_random_uuid())::text,true);
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000005","role":"authenticated"}';
select set_config('test.other',create_tenant('Agreement other','agreement-delete-other',gen_random_uuid())::text,true);
select set_config('test.foreign_seller',register_seller(current_setting('test.other')::uuid,gen_random_uuid(),'Foreign seller','','0700000003')::text,true);
select set_config('test.early_bag',receive_bag(current_setting('test.other')::uuid,gen_random_uuid(),current_setting('test.foreign_seller')::uuid,'Foreign bag before terms')::text,true);
select set_config('test.foreign_agreement',publish_seller_agreement(current_setting('test.other')::uuid,gen_random_uuid(),null,'Foreign terms','Foreign body','en',false)::text,true);
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','','0700000001')::text,true);
select set_config('test.seller2',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Second seller','','0700000002')::text,true);
select set_config('test.plain_bag',receive_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Bag before terms')::text,true);

-- An unused version, including its translation, can be removed. The number is kept.
select set_config('test.unused',gen_random_uuid()::text,true);
select set_config('test.translation',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.unused')::uuid,null,'Unused','SECRET-BODY unused','sv',false);
select publish_agreement_translation(current_setting('test.tenant')::uuid,current_setting('test.translation')::uuid,current_setting('test.unused')::uuid,'English','English text','en');
select is((select version from seller_agreement_versions where id=current_setting('test.unused')::uuid),1,'first publication is version 1');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.unused')::uuid)->>'ok','true','unused agreement deleted');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.unused')::uuid)->>'ok','true','delete replay is safe');
select is((select count(*) from seller_agreement_versions where id=current_setting('test.unused')::uuid),0::bigint,'deleted version is gone');
select is((select count(*) from seller_agreement_translations where id=current_setting('test.translation')::uuid),0::bigint,'translation removed with its version');
select is((select detail->>'version' from access_events where tenant_id=current_setting('test.tenant')::uuid and action='agreement.withdrawn' and target_id=current_setting('test.unused')::uuid),'1','withdrawal records the version');
select is((select detail->>'title' from access_events where tenant_id=current_setting('test.tenant')::uuid and action='agreement.withdrawn' and target_id=current_setting('test.unused')::uuid),'Unused','withdrawal records the title');
select ok(not exists(select 1 from access_events where action='agreement.withdrawn' and detail::text like '%SECRET-BODY%'),'withdrawal does not keep the body');
select is((select count(*) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='agreement.published' and target_id=current_setting('test.unused')::uuid),1::bigint,'publication audit remains');

select set_config('test.kept',gen_random_uuid()::text,true);
select set_config('test.kept_translation',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid,null,'Kept terms','Kept body','en',true);
select is((select version from seller_agreement_versions where id=current_setting('test.kept')::uuid),2,'deleted version number is not reused');
select publish_agreement_translation(current_setting('test.tenant')::uuid,current_setting('test.kept_translation')::uuid,current_setting('test.kept')::uuid,'Svenska','Behållen text','sv');
select set_config('test.later',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.later')::uuid,current_setting('test.kept')::uuid,'Later terms','Later body','sv',false);
select is((select version from seller_agreement_versions where id=current_setting('test.later')::uuid),3,'next live version follows the high-water mark');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.later')::uuid)->>'ok','true','latest unused version deleted');
select is((select id::text from seller_agreement_versions where tenant_id=current_setting('test.tenant')::uuid order by version desc limit 1),current_setting('test.kept'),'previous version becomes current');
select is((select count(*) from seller_agreement_translations where id=current_setting('test.kept_translation')::uuid),1::bigint,'another version''s translation stays');
select set_config('test.after',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.after')::uuid,current_setting('test.kept')::uuid,'After','After body','sv',false);
select is((select version from seller_agreement_versions where id=current_setting('test.after')::uuid),4,'publication after a gap does not reuse the removed number');
select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.after')::uuid);

-- Acceptance evidence blocks deletion and leaves the seller and the evidence in place.
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.kept')::uuid,'Paper one');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid)->>'ok','false','one linked seller blocks deletion');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid)->'usage'->>'sellers','1','one seller is explained');
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller2')::uuid,current_setting('test.kept')::uuid,'Paper two');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid)->'usage'->>'sellers','2','several linked sellers are explained');
select is((select count(*) from sellers where id in (current_setting('test.seller')::uuid,current_setting('test.seller2')::uuid)),2::bigint,'refused deletion does not remove sellers');
select is((select count(*) from seller_agreement_evidence where agreement_id=current_setting('test.kept')::uuid),2::bigint,'refused deletion does not remove evidence');
select is(seller_agreement_links(current_setting('test.tenant')::uuid,array[current_setting('test.kept')::uuid])->current_setting('test.kept')->>'sellers','2','link read matches the delete guard');

-- A drop-off can name a version even when acceptance was not recorded.
select set_config('test.receipt_agreement',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.receipt_agreement')::uuid,current_setting('test.kept')::uuid,'Receipt terms','Receipt body','sv',false);
select set_config('test.receipt',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Drop-off',current_setting('test.receipt_agreement')::uuid)::text,true);
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.receipt_agreement')::uuid)->>'ok','false','drop-off without acceptance still blocks deletion');
select ok(not (delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.receipt_agreement')::uuid)->'usage' ? 'sellers'),'drop-off link is not counted as acceptance');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.receipt_agreement')::uuid)->'usage'->>'receipts','1','drop-off is explained');
select is((select agreement_version_id::text from bag_receipts where id=current_setting('test.receipt')::uuid),current_setting('test.receipt_agreement'),'refused deletion leaves the drop-off unchanged');

-- A review can name the current version without acceptance or a drop-off reference.
select set_config('test.review_agreement',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.review_agreement')::uuid,current_setting('test.receipt_agreement')::uuid,'Review terms','Review body','sv',false);
select set_config('test.session',gen_random_uuid()::text,true);
select create_item_category(current_setting('test.tenant')::uuid,gen_random_uuid(),'Books','{"en":"Books","sv":"Böcker"}');
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.plain_bag')::uuid,current_setting('test.session')::uuid,0,'Synthetic book','Böcker','Good');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.review_agreement')::uuid)->>'ok','false','review reference blocks deletion');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.review_agreement')::uuid)->'usage'->>'reviews','1','review is explained');
select ok(not (delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.review_agreement')::uuid)->'usage' ? 'sellers'),'review without acceptance is not an acceptance count');
select ok(not (delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.review_agreement')::uuid)->'usage' ? 'receipts'),'earlier drop-off does not count against the later version');
select is((select count(*) from reception_reviews where agreement_id=current_setting('test.review_agreement')::uuid),1::bigint,'refused deletion leaves the review');
select is((select agreement_version_id from bag_receipts where id=current_setting('test.plain_bag')::uuid),null,'earlier drop-off keeps its empty agreement');

-- Frozen item terms and sale lines are links even though they are not foreign keys.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy')||'{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}');
select set_config('test.item_agreement',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.item_agreement')::uuid,current_setting('test.review_agreement')::uuid,'Item terms','Item body','sv',false);
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.item_agreement')::uuid,'Item paper');
select set_config('test.item_bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Item bag',current_setting('test.item_agreement')::uuid)::text,true);
select set_config('test.item_session',gen_random_uuid()::text,true);
select pg_temp.prepare_bag_reception(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.item_bag')::uuid,current_setting('test.item_session')::uuid,0,'Synthetic book','Böcker','Good');
select set_config('test.item',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item')::uuid,'reception_review',current_setting('test.item_session')::uuid,1,20000);
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.item_agreement')::uuid)->'usage'->>'items','1','item terms block deletion');
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','agreement-delete-sale',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',20000)));
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.item_agreement')::uuid)->>'ok','false','sold item still blocks deletion');
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.item_agreement')::uuid)->'usage'->>'sales','1','sale line is explained');
select is((select count(*) from items where id=current_setting('test.item')::uuid),1::bigint,'refused deletion does not remove the item');
select is((select count(*) from sale_lines where agreement_version_id=current_setting('test.item_agreement')::uuid),1::bigint,'refused deletion does not remove the sale');
select is((select id::text from seller_agreement_versions where id=current_setting('test.kept')::uuid),current_setting('test.kept'),'neighbouring agreement remains');
reset role;
select is((select id::text from seller_agreement_versions where id=current_setting('test.foreign_agreement')::uuid),current_setting('test.foreign_agreement'),'other store agreement remains');
select is((select count(*) from sellers where tenant_id=current_setting('test.other')::uuid),1::bigint,'other store seller remains');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.foreign_agreement')::uuid)->>'ok','true','another store''s id is absent here');
reset role;
select is((select count(*) from seller_agreement_versions where id=current_setting('test.foreign_agreement')::uuid),1::bigint,'cross-store id is not deleted');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$select delete_unused_seller_agreement(current_setting('test.other')::uuid,current_setting('test.foreign_agreement')::uuid)$$,'%FORBIDDEN%','owner cannot delete inside another store');
select throws_like($$select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,null)$$,'%INVALID_INPUT%','missing agreement rejected');
select throws_ok($$update seller_agreement_versions set title='Changed'$$,'42501',null,'published text still cannot be updated through the API');
select throws_ok($$delete from seller_agreement_versions$$,'42501',null,'direct API deletion is denied');
select throws_ok($$delete from seller_agreement_translations$$,'42501',null,'direct translation deletion is denied');

reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.tenant')::uuid,'49000000-0000-4000-8000-000000000002','staff'),
 (current_setting('test.tenant')::uuid,'49000000-0000-4000-8000-000000000003','readonly'),
 (current_setting('test.tenant')::uuid,'49000000-0000-4000-8000-000000000004','admin');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid)$$,'%FORBIDDEN%','staff cannot delete an agreement');
select is((select count(*) from seller_agreement_versions where id=current_setting('test.kept')::uuid),1::bigint,'staff refusal leaves the agreement');
select lives_ok($$select seller_agreement_links(current_setting('test.tenant')::uuid,array[current_setting('test.kept')::uuid])$$,'staff can read link counts');
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like($$select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid)$$,'%FORBIDDEN%','readonly cannot delete an agreement');
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.kept')::uuid)$$,'%FORBIDDEN%','outsider cannot delete an agreement');
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000004","role":"authenticated"}';
select set_config('test.admin_version',gen_random_uuid()::text,true);
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.admin_version')::uuid,current_setting('test.item_agreement')::uuid,'Admin terms','Admin body','sv',false);
select is(delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.admin_version')::uuid)->>'ok','true','admin can delete an unused agreement');
select is((select version from seller_agreement_versions where id=current_setting('test.item_agreement')::uuid)<(select coalesce(max((detail->>'version')::integer),0) from access_events where tenant_id=current_setting('test.tenant')::uuid and action='agreement.published'),true,'admin deletion still consumes the version number');

reset role;
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$delete from seller_agreement_versions where id=current_setting('test.kept')::uuid$$,'%AGREEMENT_IN_USE%','direct delete of a linked version is refused');
select throws_like($$delete from seller_agreement_translations where agreement_id=current_setting('test.kept')::uuid$$,'%IMMUTABLE_AGREEMENT_RECORD%','translation cannot be deleted while its version remains');
select throws_like($$update seller_agreement_versions set body='Overwrite' where id=current_setting('test.kept')::uuid$$,'%IMMUTABLE_AGREEMENT_RECORD%','version text remains immutable');
select set_config('test.direct',gen_random_uuid()::text,true);
set local role authenticated;
select publish_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.direct')::uuid,current_setting('test.item_agreement')::uuid,'Direct','Direct body','sv',false);
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_like($$delete from seller_agreement_versions where id=current_setting('test.direct')::uuid$$,'%AUTH_REQUIRED%','table owner without a store role cannot delete');
select is((select count(*) from seller_agreement_versions where id=current_setting('test.direct')::uuid),1::bigint,'unauthenticated direct delete changes nothing');
set local role anon;
select throws_ok($$select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.direct')::uuid)$$,'42501',null,'anonymous deletion denied');
select ok(not has_function_privilege('anon','public.delete_unused_seller_agreement(uuid,uuid)','execute'),'anonymous execute denied');
select ok(not has_function_privilege('anon','public.seller_agreement_links(uuid,uuid[])','execute'),'anonymous link reads denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'49000000-0000-4000-8000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
select throws_like($$select delete_unused_seller_agreement(current_setting('test.tenant')::uuid,current_setting('test.direct')::uuid)$$,'%AUTH_REQUIRED%','MFA cannot be bypassed');
select * from finish();
rollback;
