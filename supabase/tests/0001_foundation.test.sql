-- Foundation: membership is the only source of access; owner-only membership
-- administration; a tenant keeps at least one owner.
-- Runs as `authenticated` with a JWT subject, the way Supabase executes requests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Fixtures as superuser. Identities now have real Auth referential integrity.
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000f1','foundation-owner1@test.example',now()),
 ('00000000-0000-0000-0000-0000000000f2','foundation-owner2@test.example',now()),
 ('00000000-0000-0000-0000-0000000000f3','foundation-staff@test.example',now()),
 ('00000000-0000-0000-0000-0000000000f5','foundation-outsider@test.example',now());
insert into tenants (id, slug, name, created_by)
  values ('00000000-0000-0000-0000-000000000001', 'one', 'Store one', '00000000-0000-0000-0000-0000000000f1');
insert into tenants (id, slug, name, created_by)
  values ('00000000-0000-0000-0000-000000000002', 'two', 'Store two', '00000000-0000-0000-0000-0000000000f2');
insert into tenant_members (tenant_id, user_id, role)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'staff');

select is((select role from tenant_members where user_id = '00000000-0000-0000-0000-0000000000f1'), 'owner', 'creator became owner');

-- Outsider: sees nothing, can do nothing.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select is((select count(*) from tenants), 0::bigint, 'outsider sees no tenants');
select is((select count(*) from tenant_members), 0::bigint, 'outsider sees no members');
select throws_ok(
  $$ insert into tenant_members (tenant_id, user_id, role)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f5', 'owner') $$,
  '42501'
);

-- Outsider may create a tenant and becomes its owner.
select lives_ok(
  $$ select create_tenant('My store','mine','30000000-0000-0000-0000-000000000001') $$,
  'anyone may create their own tenant'
);
select is((select role from tenant_members where user_id = '00000000-0000-0000-0000-0000000000f5'), 'owner', 'creator of a new tenant is its owner');
select throws_ok(
  $$ insert into tenants (slug, name, created_by) values ('theirs', 'Not mine', '00000000-0000-0000-0000-0000000000f1') $$,
  '42501'
);

-- Staff: sees own tenant only, cannot administer members.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select is((select count(*) from tenants), 1::bigint, 'staff sees exactly their tenant');
select throws_ok(
  $$ insert into tenant_members (tenant_id, user_id, role)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f5', 'staff') $$,
  '42501'
);

-- Owner: administers members, cannot remove the last owner.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select create_invitation('00000000-0000-0000-0000-000000000001','foundation-outsider@test.example','readonly',repeat('f',64)) $$,
  'owner creates an invitation'
);
select throws_like(
  $$ select change_member('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',null) $$,
  '%last owner%', 'last owner cannot be removed'
);
select throws_like(
  $$ select change_member('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','staff') $$,
  '%last owner%', 'last owner cannot be demoted'
);

reset role;
select * from finish();
rollback;

