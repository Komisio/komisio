begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000981','settings-host@example.test',now()),
 ('f0000000-0000-4000-8000-000000000982','settings-member@example.test',now());
insert into public.platform_hosts(user_id) values('f0000000-0000-4000-8000-000000000981');
select set_config('test.included',ai_included_ore::text,true) from public.platform_settings;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000981","role":"authenticated"}';
select is((set_ai_platform_settings('{"enabled":true}')->>'enabled')::boolean,true,'host can enable credits with a partial settings update');
select is((ai_platform_settings()->>'includedOre')::text,current_setting('test.included'),'enabling preserves the included credit allowance');
select is((set_ai_platform_settings('{"enabled":false}')->>'enabled')::boolean,false,'host can disable metering again');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000982","role":"authenticated"}';
select throws_ok($$select set_ai_platform_settings('{"enabled":true}')$$,'42501','FORBIDDEN','a non-host cannot change platform settings');
select * from finish();
rollback;
