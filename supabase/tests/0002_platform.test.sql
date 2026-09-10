begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000001','owner@platform.test',now()),
 ('10000000-0000-0000-0000-000000000002','staff@platform.test',now()),
 ('10000000-0000-0000-0000-000000000003','outsider@platform.test',now()),
 ('10000000-0000-0000-0000-000000000004','admin@platform.test',now());
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select create_tenant('Platform store','platform-test','20000000-0000-0000-0000-000000000001')$$,'tenant creation returns the tenant');
select lives_ok($$select create_tenant('Platform store','platform-test','20000000-0000-0000-0000-000000000001')$$,'creation retry is idempotent');
select is((select count(*) from tenants where slug='platform-test'),1::bigint,'retry did not duplicate tenant');
select is((select tenant_role(id) from tenants where slug='platform-test'),'owner','creator is owner');
select throws_ok($$insert into tenant_members select id,'10000000-0000-0000-0000-000000000002','staff',null,now() from tenants where slug='platform-test'$$,'42501');
select lives_ok($$select create_invitation((select id from tenants where slug='platform-test'),'staff@platform.test','staff',repeat('a',64))$$,'owner invites staff');
select lives_ok($$select create_invitation((select id from tenants where slug='platform-test'),'admin@platform.test','admin',repeat('b',64))$$,'owner invites admin');
select throws_like($$select change_member((select id from tenants where slug='platform-test'),'10000000-0000-0000-0000-000000000001',null)$$,'%last owner%','last owner retained');

set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from tenants),0::bigint,'outsider sees no tenant');
select throws_like($$select accept_invitation(repeat('a',64))$$,'%INVITATION_INVALID%','wrong identity cannot accept');

set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select accept_invitation(repeat('a',64))$$,'intended identity accepts');
select is((select tenant_role(id) from tenants where slug='platform-test'),'staff','invited role assigned');
select throws_like($$select accept_invitation(repeat('a',64))$$,'%INVITATION_INVALID%','token cannot be replayed');
select throws_like($$select create_invitation((select id from tenants where slug='platform-test'),'outsider@platform.test','owner',repeat('c',64))$$,'%FORBIDDEN%','staff cannot invite or escalate');

set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$select accept_invitation(repeat('b',64))$$,'admin accepts');
select throws_like($$select change_member((select id from tenants where slug='platform-test'),'10000000-0000-0000-0000-000000000002','owner')$$,'%FORBIDDEN%','admin cannot create an owner');
select lives_ok($$select change_member((select id from tenants where slug='platform-test'),'10000000-0000-0000-0000-000000000002',null)$$,'admin removes staff');
reset role;
select * from finish();
rollback;
