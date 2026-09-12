begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000041','items-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000042','items-reader@example.test',now()),
 ('f0000000-0000-4000-8000-000000000044','items-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000041","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Items test','items-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','seller@items.test','')::text,true);
-- Bag path: receipt, then a draft.
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',null)::text,true);
select set_config('test.draft',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft')::uuid,0,'Synthetic jacket','Jackets','Good');
select set_config('test.item1',gen_random_uuid()::text,true);
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000)$$,'%AGREEMENT_REQUIRED%','default policy requires agreement evidence at acceptance');
select set_config('test.agreement',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Synthetic terms','Only a test','en',false)::text,true);
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000)$$,'%AGREEMENT_REQUIRED%','a published agreement without evidence is not consent');
select record_agreement_evidence(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Signed paper 1');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,2,25000)$$,'%INSPECTION_DRAFT_CHANGED%','wrong revision rejected');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',gen_random_uuid(),1,25000)$$,'%ORIGIN_NOT_FOUND%','unknown draft rejected');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,0)$$,'%INVALID_INPUT%','zero price rejected');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,null,25000)$$,'%INVALID_INPUT%','draft origin needs a revision');
select is(accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000),current_setting('test.item1')::uuid,'bag-path item accepted with staff-recorded evidence');
select is(accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,25000),current_setting('test.item1')::uuid,'exact replay returns the item');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item1')::uuid,'inspection_draft',current_setting('test.draft')::uuid,1,26000)$$,'%REQUEST_CONFLICT%','replay with another price rejected');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',current_setting('test.draft')::uuid,1,25000)$$,'%ITEM_EXISTS%','one item per origin');
select set_config('test.terms',(select terms::text from items where id=current_setting('test.item1')::uuid),true);
select is(current_setting('test.terms')::jsonb->>'evidenceKind','staff_recorded','evidence kind frozen');
select is(current_setting('test.terms')::jsonb->>'agreementVersionId',current_setting('test.agreement'),'agreement version frozen');
select is((current_setting('test.terms')::jsonb->>'commissionRatePercent')::numeric,60::numeric,'commission from policy frozen');
select is(current_setting('test.terms')::jsonb->>'ownership','consignment','consignment ownership');
select is((current_setting('test.terms')::jsonb->>'salePeriodDays')::int,42,'sale period frozen');
select is((select custody_kind from items where id=current_setting('test.item1')::uuid),'bag','bag custody referenced');
select is((select seller_id from items where id=current_setting('test.item1')::uuid),current_setting('test.seller')::uuid,'seller referenced');
select is((select price_ore from item_prices where item_id=current_setting('test.item1')::uuid),25000::bigint,'first price row is the accepted price');
select is((select count(*) from item_events where item_id=current_setting('test.item1')::uuid),2::bigint,'accepted and price_set events');
-- Later policy or seller terms never touch the frozen item.
select set_config('test.body',(current_store_policy(current_setting('test.tenant')::uuid)->'policy')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,current_setting('test.body')::jsonb || '{"commissionRatePercent":40}');
select publish_seller_terms(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,null,null,30,'');
select is((select (terms->>'commissionRatePercent')::numeric from items where id=current_setting('test.item1')::uuid),60::numeric,'frozen commission survives policy and seller changes');
-- A second draft on the same bag freezes the new effective terms.
select set_config('test.draft2',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.draft2')::uuid,0,'Synthetic scarf','Accessories','Fair');
select set_config('test.item2',gen_random_uuid()::text,true);
select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item2')::uuid,'inspection_draft',current_setting('test.draft2')::uuid,1,9900);
select is((select (terms->>'commissionRatePercent')::numeric from items where id=current_setting('test.item2')::uuid),30::numeric,'seller override frozen on the new item');
select is((select terms->>'sellerTermsVersion' from items where id=current_setting('test.item2')::uuid),'1','seller terms version recorded');
-- Garment path: review without custody, then custody.
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,
 '[{"id":"f0000000-0000-4000-8000-000000000051","kind":"observation","reference":"Staff","observation":"Synthetic coat"},{"id":"f0000000-0000-4000-8000-000000000052","kind":"price-evidence","reference":"Staff estimate","observation":"300 SEK"}]'::jsonb);
select set_config('test.suggestions','{"metadata":{"description":{"value":"Synthetic coat","sourceIds":["f0000000-0000-4000-8000-000000000051"],"certainty":"observed"}},"price":{"currency":"SEK","amount":"300.00","rationale":"Staff estimate","sourceIds":["f0000000-0000-4000-8000-000000000052"]},"questions":[]}',true);
select set_config('test.review',gen_random_uuid()::text,true);
select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.agreement')::uuid,current_setting('test.suggestions')::jsonb,now()+interval '1 day');
select set_config('test.item3',gen_random_uuid()::text,true);
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item3')::uuid,'reception_review',current_setting('test.session')::uuid,1,30000)$$,'%CUSTODY_REQUIRED%','a review is not custody');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,'Rail 3');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item3')::uuid,'reception_review',current_setting('test.session')::uuid,2,30000)$$,'%RECEPTION_REVIEW_CHANGED%','wrong review version rejected');
select is(accept_item(current_setting('test.tenant')::uuid,current_setting('test.item3')::uuid,'reception_review',current_setting('test.session')::uuid,1,32000),current_setting('test.item3')::uuid,'delegated pricing accepts without a seller response, store price');
select is((select terms->>'evidenceKind' from items where id=current_setting('test.item3')::uuid),'staff_recorded','falls back to staff-recorded evidence for the current agreement');
select is((select custody_kind from items where id=current_setting('test.item3')::uuid),'garment','garment custody referenced');
select is((select price_ore from item_prices where item_id=current_setting('test.item3')::uuid),32000::bigint,'store-set price frozen');
-- Per-item mode demands the seller's approval of that exact review.
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),(current_store_policy(current_setting('test.tenant')::uuid)->>'id')::uuid,current_setting('test.body')::jsonb || '{"sellerReviewMode":"per_item"}');
select set_config('test.session2',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,0,
 '[{"id":"f0000000-0000-4000-8000-000000000053","kind":"observation","reference":"Staff","observation":"Synthetic hat"},{"id":"f0000000-0000-4000-8000-000000000054","kind":"price-evidence","reference":"Staff estimate","observation":"100 SEK"}]'::jsonb);
select publish_reception_review(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,1,null,current_setting('test.agreement')::uuid,
 '{"metadata":{"description":{"value":"Synthetic hat","sourceIds":["f0000000-0000-4000-8000-000000000053"],"certainty":"observed"}},"price":{"currency":"SEK","amount":"100.00","rationale":"Staff estimate","sourceIds":["f0000000-0000-4000-8000-000000000054"]},"questions":[]}'::jsonb,now()+interval '1 day');
select receive_garment(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session2')::uuid,'');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'reception_review',current_setting('test.session2')::uuid,1,10000)$$,'%SELLER_APPROVAL_REQUIRED%','per-item mode needs the seller response');
-- Purchase path: store-owned, no seller, no agreement.
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'Flea market',15000,'Receipt 7',true)::text,true);
select set_config('test.item4',gen_random_uuid()::text,true);
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,current_setting('test.item4')::uuid,'purchase',current_setting('test.purchase')::uuid,1,25000)$$,'%INVALID_INPUT%','purchase origin has no revision');
select is(accept_item(current_setting('test.tenant')::uuid,current_setting('test.item4')::uuid,'purchase',current_setting('test.purchase')::uuid,null,25000),current_setting('test.item4')::uuid,'purchase accepted');
select is((select ownership from items where id=current_setting('test.item4')::uuid),'store','store ownership');
select is((select seller_id from items where id=current_setting('test.item4')::uuid),null,'no seller');
select is((select (terms->>'purchasePriceOre')::bigint from items where id=current_setting('test.item4')::uuid),15000::bigint,'purchase price frozen');
select is((select terms->>'marginEligible' from items where id=current_setting('test.item4')::uuid),'true','margin attestation frozen');
select is((select terms->>'evidenceKind' from items where id=current_setting('test.item4')::uuid),'none','no agreement evidence for store goods');
select throws_like($$select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,25000)$$,'%ITEM_EXISTS%','one item per purchase');
select throws_ok($$update items set ownership='store'$$,'42501',null,'direct update denied');
select throws_ok($$delete from item_prices$$,'42501',null,'direct delete denied');
reset role;
select throws_like($$update items set ownership='store' where id=current_setting('test.item1')::uuid$$,'%IMMUTABLE_ITEM%','privileged update immutable');
select throws_like($$delete from item_events where item_id=current_setting('test.item1')::uuid$$,'%IMMUTABLE_ITEM%','privileged delete immutable');
insert into tenant_members(tenant_id,user_id,role) values (current_setting('test.tenant')::uuid,'f0000000-0000-4000-8000-000000000042','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000042","role":"authenticated"}';
select is((select count(*) from items),4::bigint,'readonly reads items');
select throws_ok($$select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,25000)$$,'42501',null,'readonly cannot accept');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000044","role":"authenticated"}';
select is((select count(*) from items),0::bigint,'RLS hides other tenants');
select throws_ok($$select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,25000)$$,'42501',null,'outsider cannot accept');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000041','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000041","role":"authenticated","aal":"aal1"}';
select throws_ok($$select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,25000)$$,'42501',null,'MFA enforced');
select * from finish();
rollback;
