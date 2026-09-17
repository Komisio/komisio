begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Seller reads are STABLE, so PostgreSQL forbids FOR UPDATE inside them; only the response locks.
select is((select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='komisio_private' and p.proname='seller_review_read'),'s','seller read cannot take row locks');
select is((select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='read_seller_review'),'s','review page read is stable');
select is((select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='read_seller_review_photo'),'s','photo descriptor read is stable');
select is((select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='komisio_private' and p.proname='seller_review'),'v','response path keeps the locking variant');
select ok(not has_function_privilege('authenticated','komisio_private.seller_review_read(text)','execute'),'read helper is not callable directly');
-- Same behaviour as before the split, through the public functions.
insert into auth.users(id,email,email_confirmed_at) values
 ('d0000000-0000-4000-8000-000000000001','staff@reads.test',now()),
 ('d0000000-0000-4000-8000-000000000002','seller@reads.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Reads','reads-test',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Seller','seller@reads.test','')::text,true);
select set_config('test.session',create_reception_session(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid)::text,true);
select set_config('test.terms',publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'TEST','Fictional terms','en',false)::text,true);
select save_reception_sources(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.session')::uuid,0,'[{"id":"d0000000-0000-4000-8000-000000000010","kind":"price-evidence","reference":"TEST","observation":"Fictional 80 SEK"}]'::jsonb);
select set_config('test.review',gen_random_uuid()::text,true);
select publish_reception_review(current_setting('test.tenant')::uuid,current_setting('test.review')::uuid,current_setting('test.session')::uuid,1,null,current_setting('test.terms')::uuid,'{"attributes":[{"slug":"description","definitionVersion":1,"value":"TEST shirt","sourceIds":["d0000000-0000-4000-8000-000000000010"],"certainty":"observed"}],"price":{"currency":"SEK","amount":"80.00","rationale":"TEST","sourceIds":["d0000000-0000-4000-8000-000000000010"]},"questions":[]}'::jsonb,now()+interval '1 day');
select set_config('test.access',gen_random_uuid()::text,true);
select set_reception_access(current_setting('test.tenant')::uuid,current_setting('test.access')::uuid,current_setting('test.review')::uuid,null,encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex'));
select throws_like($$select read_seller_review(repeat('e',64))$$,'%REVIEW_UNAVAILABLE%','staff cannot read as the seller');
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((read_seller_review(repeat('e',64))->>'reviewId'),current_setting('test.review'),'seller reads the exact review');
select is((read_seller_review(repeat('e',64))->>'photos'),'[]','pinned photo list present');
select throws_like($$select read_seller_review_photo(repeat('e',64),gen_random_uuid())$$,'%REVIEW_UNAVAILABLE%','unpinned photo denied');
select throws_like($$select read_seller_review(repeat('f',64))$$,'%REVIEW_UNAVAILABLE%','wrong token denied');
select lives_ok($$select respond_to_reception_review(repeat('e',64),gen_random_uuid(),current_setting('test.review')::uuid,'decline')$$,'response still goes through the locking path');
select is(read_seller_review(repeat('e',64))->'response'->>'decision','decline','read shows the saved response');
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_reception_access(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.review')::uuid,current_setting('test.access')::uuid,null);
set local "request.jwt.claims"='{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$select read_seller_review(repeat('e',64))$$,'%REVIEW_UNAVAILABLE%','revoked link denied on the read path');
set local role anon;
select throws_ok($$select read_seller_review(repeat('e',64))$$,'42501',null,'anonymous denied');
select throws_ok($$select read_seller_review_photo(repeat('e',64),gen_random_uuid())$$,'42501',null,'anonymous photo denied');
select * from finish();
rollback;
