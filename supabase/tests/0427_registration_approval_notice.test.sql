begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f4270000-0000-4000-8000-000000000001','approval-owner@example.test',now()),
 ('f4270000-0000-4000-8000-000000000002','approval-first@example.test',now()),
 ('f4270000-0000-4000-8000-000000000003','approval-legacy@example.test',now()),
 ('f4270000-0000-4000-8000-000000000004','approval-rejected@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic approval store','approval-notice-test',gen_random_uuid()) as tenant \gset
select create_tenant('Other approval store','approval-notice-other',gen_random_uuid()) as other \gset
select publish_seller_agreement(:'tenant',gen_random_uuid(),null,'Synthetic agreement','Synthetic legal text','en',true) as agreement \gset
select set_seller_registration(:'tenant',gen_random_uuid(),null,'enable');
select seller_registration_settings(:'tenant')->>'token' as token \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy')||'{"automaticSellerNotifications":false}');
select gen_random_uuid() as application \gset
select set_config('test.token',:'token',true),set_config('test.agreement',:'agreement',true);
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$select submit_seller_registration_in_language(current_setting('test.token'),gen_random_uuid(),'Synthetic applicant','000',current_setting('test.agreement')::uuid,null,true,null,'xx')$$,'%INVALID_INPUT%','invalid locale rejected');
select submit_seller_registration_in_language(:'token',:'application','Synthetic applicant','000',:'agreement',null,true,null,'dk');
select lives_ok(format('select submit_seller_registration_in_language(%L,%L,''Synthetic applicant'',''000'',%L,null,true,null,''en'')',:'token',:'application',:'agreement'),'locale change on retry does not rewrite original application');
select throws_ok(format('select registration_approval_notice(%L,gen_random_uuid())',:'tenant'),'42501',null,'seller cannot inspect approval delivery');
reset role;
select is((select application_locale from seller_registrations where id=:'application'),'dk','first application locale frozen separately from English agreement');
select throws_like(format('update seller_registrations set application_locale=''en'' where id=%L',:'application'),'%IMMUTABLE_AGREEMENT_RECORD%','locale cannot be rewritten');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000001","role":"authenticated"}';
select gen_random_uuid() as review \gset
select review_seller_registration(:'tenant',:'review',:'application',true) as seller \gset
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_my_seller_notifications(:'tenant',:'seller',gen_random_uuid(),false);
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000001","role":"authenticated"}';
select registration_approval_notice(:'tenant',:'review') as facts \gset
select is((:'facts'::jsonb)->>'locale','dk','application locale wins regardless of staff/store language');
select is((:'facts'::jsonb)->>'storeName','Synthetic approval store','store name retained');
select ok(not (:'facts'::jsonb ? 'phone'),'no phone in notification facts');
select ok(:'facts'::jsonb is not null,'direct reply ignores both routine notification opt-outs');
select is(registration_approval_notice(:'other',:'review'),null::jsonb,'review cannot be used in a different tenant');
select gen_random_uuid() as message \gset
select is(claim_registration_approval_notice(:'message',:'facts','dk','Synthetic approved','Synthetic message'),:'message'::uuid,'one committed claim authorizes one attempt');
select is(claim_registration_approval_notice(:'message',:'facts','dk','Synthetic approved','Synthetic message'),null::uuid,'same request replay cannot recover send permission');
select is(claim_registration_approval_notice(gen_random_uuid(),:'facts','dk','Synthetic approved','Synthetic message'),null::uuid,'different message ID cannot resend the same approval');
select is((select count(*) from seller_communications where registration_review_id=:'review'),1::bigint,'exactly one history entry');
select is(registration_approval_notice(:'tenant',:'review'),null::jsonb,'claimed approvals no longer returned');
select is((select locale from seller_communications where id=:'message'),'dk','history freezes delivered locale');
select is((select recipient from seller_communications where id=:'message'),'approval-first@example.test','recipient is approved verified application account');
select throws_like(format('select queue_seller_communication(%L,%L,%L,''message'',''seller.registration_approved'',''v1'',''dk'',''Synthetic approved'',''Synthetic message'',''none'',null)',:'tenant',:'message',:'seller'),'%INVALID_INPUT%','generic manual-mail replay cannot recover send permission');
select record_communication_delivery(:'tenant',:'message','unconfirmed','');
select is(claim_registration_approval_notice(gen_random_uuid(),:'facts','dk','Synthetic approved','Synthetic message'),null::uuid,'unknown transport result never resends');
reset role;
select set_config('komisio.communication_delivery','engine',true);
select throws_like(format('update seller_communications set registration_review_id=null where id=%L',:'message'),'%IMMUTABLE_COMMUNICATION%','claim association is immutable');
select set_config('komisio.communication_delivery','',true);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000003","role":"authenticated"}';
select gen_random_uuid() as legacy_application \gset
select submit_seller_registration(:'token',:'legacy_application','Legacy applicant','000',:'agreement',null,true);
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000001","role":"authenticated"}';
select gen_random_uuid() as legacy_review \gset
select review_seller_registration(:'tenant',:'legacy_review',:'legacy_application',true);
select registration_approval_notice(:'tenant',:'legacy_review') as old_facts \gset
select is(:'old_facts'::jsonb->>'locale','en','legacy application falls back to English without store language');
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,(current_store_policy(:'tenant')->'policy')||'{"communicationLanguage":"it"}');
select is(registration_approval_notice(:'tenant',:'legacy_review')->>'locale','it','saved communication language is the store fallback');
select publish_store_profile(:'tenant',gen_random_uuid(),null,'{"address":{"street":"","postalCode":"","city":""},"contact":{"email":"","phone":"","website":""},"openingHours":[],"accepts":"","concept":"","language":"sv"}');
select is(registration_approval_notice(:'tenant',:'legacy_review')->>'locale','sv','public store language takes priority over policy fallback');
select is(claim_registration_approval_notice(gen_random_uuid(),:'old_facts','en','Stale','Stale'),null::uuid,'changed facts require a new read before any claim');
select registration_approval_notice(:'tenant',:'legacy_review') as legacy_facts \gset
reset role;
update platform_settings set email_new_cap=0,email_daily_cap=0;
set local role authenticated;
select throws_like(format('select claim_registration_approval_notice(gen_random_uuid(),%L,''sv'',''Capped'',''Capped'')',:'legacy_facts'),'%EMAIL_DAILY_CAP%','approval does not bypass host mail caps');
reset role;
update platform_settings set email_new_cap=50,email_daily_cap=1000;
set local role authenticated;
select throws_like(format('select claim_registration_approval_notice(gen_random_uuid(),%L,''dk'',''Wrong language'',''Wrong language'')',:'legacy_facts'),'%INVALID_INPUT%','unrelated locale cannot replace resolved language');
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000004","role":"authenticated"}';
select gen_random_uuid() as rejected_application \gset
select submit_seller_registration_in_language(:'token',:'rejected_application','Rejected applicant','000',:'agreement',null,true,null,'fi');
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000001","role":"authenticated"}';
select gen_random_uuid() as rejected_review \gset
select review_seller_registration(:'tenant',:'rejected_review',:'rejected_application',false);
select is(registration_approval_notice(:'tenant',:'rejected_review'),null::jsonb,'rejection produces no approval notice');
reset role;
update auth.users set deleted_at=now() where id='f4270000-0000-4000-8000-000000000003';
set local role authenticated;
select is(registration_approval_notice(:'tenant',:'legacy_review'),null::jsonb,'soft-deleted applicant cannot receive an approval notice');
reset role;
update auth.users set deleted_at=null where id='f4270000-0000-4000-8000-000000000003';
update auth.users set email='changed-identity@example.test' where id='f4270000-0000-4000-8000-000000000003';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f4270000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(registration_approval_notice(:'tenant',:'legacy_review'),null::jsonb,'changed application identity blocks stale recipient');
select is(claim_registration_approval_notice(gen_random_uuid(),:'legacy_facts','sv','Stale','Stale'),null::uuid,'identity is rechecked at claim');
reset role;
select ok(not has_function_privilege('anon','public.claim_registration_approval_notice(uuid,jsonb,text,text,text)','execute'),'anonymous claim forbidden');
select ok(not has_table_privilege('authenticated','public.seller_communications','insert'),'direct message insert forbidden');
select * from finish();
rollback;
