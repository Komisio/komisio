-- Access control: membership is the only source of access; roles are enforced
-- by RLS and grants, not by the application. Runs as `authenticated` with a
-- JWT subject, the way PostgREST/Supabase executes requests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixtures (as superuser). The tenant's creator becomes its owner via trigger.
insert into tenants (id, slug, name, created_by)
  values ('00000000-0000-0000-0000-000000000001', 'one', 'Store one', '00000000-0000-0000-0000-0000000000f1');
insert into tenants (id, slug, name, created_by)
  values ('00000000-0000-0000-0000-000000000002', 'two', 'Store two', '00000000-0000-0000-0000-0000000000f2');
insert into tenant_members (tenant_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'staff'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f4', 'readonly');
-- f5 is a member of nobody.

set local "komisio.actor_type" = 'system';
set local "komisio.actor_id" = 'fixture';
insert into sellers (id, tenant_id, display_name)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Anna Consignor');
insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'Jug', 40, true, 100, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c001', 'for_sale');
insert into sales (id, tenant_id, channel) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'manual');
reset "komisio.actor_type";
reset "komisio.actor_id";

select is((select role from tenant_members where user_id = '00000000-0000-0000-0000-0000000000f1'), 'owner', 'creator became owner');

-- ---------------------------------------------------------------- outsider
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';

select is((select count(*) from items), 0::bigint, 'outsider sees no items');
select is((select count(*) from tenants), 0::bigint, 'outsider sees no tenants');
select throws_ok(
  $$ insert into sellers (tenant_id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Intruder') $$,
  '42501'
);
select throws_ok(
  $$ select transition_item('00000000-0000-0000-0000-00000000c001', 'expired') $$,
  '42501'
);

-- ---------------------------------------------------------------- readonly
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';

select is((select count(*) from items), 1::bigint, 'readonly sees the tenant''s items');
select throws_ok(
  $$ insert into sellers (tenant_id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Nope') $$,
  '42501'
);
select is(
  (with u as (update items set title = 'changed' where id = '00000000-0000-0000-0000-00000000c001' returning 1) select count(*) from u),
  0::bigint, 'readonly update touches no rows'
);
select throws_ok(
  $$ select transition_item('00000000-0000-0000-0000-00000000c001', 'expired') $$,
  '42501'
);

-- ---------------------------------------------------------------- staff
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';

select lives_ok(
  $$ insert into sellers (tenant_id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Bertil Consignor') $$,
  'staff can register a consignor'
);
select throws_ok(
  $$ update items set status = 'sold' where id = '00000000-0000-0000-0000-00000000c001' $$,
  '42501'
);
select throws_ok(
  $$ insert into seller_ledger (tenant_id, seller_id, entry_type, amount, actor_type)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'sale_credit', 10, 'user') $$,
  '42501'
);
select throws_ok(
  $$ insert into payouts (tenant_id, seller_id, amount, method, status)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 10, 'swish', 'approved') $$,
  '42501'
);
select throws_ok(
  $$ insert into tenant_members (tenant_id, user_id, role)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f5', 'staff') $$,
  '42501'
);
select lives_ok(
  $$ select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100) $$,
  'staff can record a sale through the function'
);
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 60.00::numeric, 'staff reads balances through the view');

-- ---------------------------------------------------------------- owner
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select lives_ok(
  $$ insert into tenant_members (tenant_id, user_id, role)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f5', 'staff') $$,
  'owner can add a member'
);
select throws_like(
  $$ delete from tenant_members where tenant_id = '00000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '%last owner%', 'the last owner cannot be removed'
);

reset role;
select * from finish();
rollback;
