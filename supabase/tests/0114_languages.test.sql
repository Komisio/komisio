begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000000981','languages@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000981","role":"authenticated"}';
-- A profile may choose any of the eight product languages; nothing else.
select lives_ok($$select save_profile('Kari','no')$$,'Norwegian profile');
select lives_ok($$select save_profile('Kari','fi')$$,'Finnish profile');
select throws_like($$select save_profile('Kari','pt')$$,'%INVALID_INPUT%','an unsupported language is refused');
select set_config('test.tenant',create_tenant('Sprachladen','languages-test',gen_random_uuid())::text,true);
-- Seller agreements and store profiles carry the same languages.
select lives_ok($$select publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Vertrag','Text','de',true)$$,'a German agreement');
select throws_like($$select publish_seller_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),null,'Vertrag','Text','pt',true)$$,'%INVALID_INPUT%','an unsupported agreement language is refused');
select is((select language from seller_agreement_versions where tenant_id=current_setting('test.tenant')::uuid),'de','stored');
-- Seller communications are queued in the seller's language.
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Chiara','c@languages.test','')::text,true);
select lives_ok($$select queue_seller_communication(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'message','message','v1','it','Ciao','Testo','none',null)$$,'an Italian message');
select * from finish();
rollback;
