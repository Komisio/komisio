begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
 ('f4660000-0000-4000-8000-000000000001','consent-one@example.test',now(),'{"marketing_consent":true,"marketing_consent_version":"product-news-v1"}'),
 ('f4660000-0000-4000-8000-000000000002','consent-two@example.test',now(),'{}'),
 ('f4660000-0000-4000-8000-000000000003','consent-three@example.test',null,'{"marketing_consent":false,"marketing_consent_version":"product-news-v1"}'),
 ('f4660000-0000-4000-8000-000000000004','consent-four@example.test',now(),'{"marketing_consent":"true","marketing_consent_version":"product-news-v1"}');
select is((select count(*) from marketing_consent_events where user_id::text like 'f466%'),2::bigint,'only typed explicit choices recorded');
select ok((select recorded_at is not null and text_version='product-news-v1' and source='signup' from marketing_consent_events where user_id='f4660000-0000-4000-8000-000000000001'),'server evidence retained');
update auth.users set raw_user_meta_data='{"marketing_consent":true,"marketing_consent_version":"product-news-v1"}' where id='f4660000-0000-4000-8000-000000000002';
select is((select count(*) from marketing_consent_events where user_id='f4660000-0000-4000-8000-000000000002'),0::bigint,'mutable metadata never adds consent');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f4660000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select is((my_marketing_consent()->>'consented')::boolean,true,'own initial choice');
select is((select count(*) from marketing_consent_events),1::bigint,'cannot read another user');
select throws_ok($$insert into marketing_consent_events(user_id,consented,text_version,source) values('f4660000-0000-4000-8000-000000000002',true,'product-news-v1','account')$$,'42501',null,'direct insert denied');
select throws_ok($$update marketing_consent_events set consented=false$$,'42501',null,'direct update denied');
select throws_ok($$delete from marketing_consent_events$$,'42501',null,'direct delete denied');
select is((set_marketing_consent(false)->>'consented')::boolean,false,'can withdraw');
select is((select count(*) from marketing_consent_events),2::bigint,'withdrawal appended');
select is((set_marketing_consent(false)->>'consented')::boolean,false,'repeat is stable');
select is((select count(*) from marketing_consent_events),2::bigint,'repeat creates no duplicate');
select is((set_marketing_consent(true)->>'consented')::boolean,true,'can opt back in');
select throws_ok($$select set_marketing_consent(null)$$,'P0001','INVALID_INPUT','null denied');
select set_config('request.jwt.claims','{"sub":"f4660000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(my_marketing_consent(),'{"consented":false,"recorded_at":null,"text_version":null}'::jsonb,'existing user is not opted in');
select is((select count(*) from marketing_consent_events),0::bigint,'no shared tenant access');
select set_config('request.jwt.claims','{"sub":"f4660000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select set_marketing_consent(true)$$,'42501','AUTH_REQUIRED','unverified user denied');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,friendly_name,secret,created_at,updated_at) values
 ('f4660000-0000-4000-8000-000000000011','f4660000-0000-4000-8000-000000000001','totp','verified','Synthetic factor','synthetic',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f4660000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select set_marketing_consent(false)$$,'42501','AUTH_REQUIRED','MFA is required');
set local role anon;
select throws_ok($$select my_marketing_consent()$$,'42501',null,'anonymous read denied');
reset role;
select throws_ok($$update marketing_consent_events set consented=false$$,'P0001','IMMUTABLE_MARKETING_CONSENT','even privileged update cannot rewrite history');
select throws_ok($$delete from marketing_consent_events$$,'P0001','IMMUTABLE_MARKETING_CONSENT','history deletion denied');
select * from finish();
rollback;
