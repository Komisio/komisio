-- R2: a payout can never exceed the consignor's balance; status only through transition_payout()
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into tenants (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'test', 'Test store');
insert into sellers (id, tenant_id, display_name)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Anna Consignor');

set local "komisio.actor_type" = 'user';
set local "komisio.actor_id" = 'test-user';

-- Balance 60 from one sale (100, 40 %).
insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'Jug', 40, true, 100, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c001', 'for_sale');
insert into sales (id, tenant_id, channel) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'manual');
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100);

-- 1. A payout cannot be born approved.
select throws_like(
  $$ insert into payouts (tenant_id, seller_id, amount, method, status)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 10, 'swish', 'approved') $$,
  '%created as pending%', 'insert with status approved is refused'
);

-- 2. 100 exceeds the balance of 60 -> P0002, balance untouched.
insert into payouts (id, tenant_id, seller_id, amount, method)
  values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 100, 'swish');
select throws_ok(
  $$ select transition_payout('00000000-0000-0000-0000-00000000e001', 'approved') $$,
  'P0002'
);
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 60.00::numeric, 'balance untouched after refusal');

-- 3. Status is not writable directly.
select throws_like(
  $$ update payouts set status = 'approved' where id = '00000000-0000-0000-0000-00000000e001' $$,
  '%transition_payout()%', 'direct status update is refused'
);

-- 4. 50 is approved: ledger debit, balance 10, approver recorded.
insert into payouts (id, tenant_id, seller_id, amount, method)
  values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 50, 'swish');
select transition_payout('00000000-0000-0000-0000-00000000e002', 'approved');
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 10.00::numeric, 'balance 10 after approval');
select is((select approved_by from payouts where id = '00000000-0000-0000-0000-00000000e002'), 'test-user', 'approver recorded');
select is((select amount from seller_ledger where ref_id = '00000000-0000-0000-0000-00000000e002' and entry_type = 'payout'), -50.00::numeric, 'debit -50 in the ledger');

-- 5. approved -> confirmed is illegal (must pass sent).
select throws_like(
  $$ select transition_payout('00000000-0000-0000-0000-00000000e002', 'confirmed') $$,
  '%illegal payout transition approved -> confirmed%', 'approved -> confirmed refused'
);

-- 6. sent -> failed reverses the reservation.
select transition_payout('00000000-0000-0000-0000-00000000e002', 'sent', 'swish-ref-1');
select transition_payout('00000000-0000-0000-0000-00000000e002', 'failed');
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 60.00::numeric, 'balance restored to 60 after failure');

-- 7. Payouts are never deleted.
select throws_like(
  $$ delete from payouts where id = '00000000-0000-0000-0000-00000000e001' $$,
  '%never deleted%', 'delete refused'
);

select * from finish();
rollback;
