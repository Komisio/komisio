-- Customer returns: history kept, consignor credit reversed, item sellable again
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into tenants (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'test', 'Test store');
insert into sellers (id, tenant_id, display_name)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Anna Consignor');

set local "komisio.actor_type" = 'user';
set local "komisio.actor_id" = 'test-user';

insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'Jug', 40, true, 100, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c001', 'for_sale');
insert into sales (id, tenant_id, channel) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'manual'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-000000000001', 'manual');
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100);

-- 1. Returns cannot be recorded directly.
select throws_like(
  $$ insert into sale_returns (tenant_id, sale_line_id, refund_amount, actor_type)
     values ('00000000-0000-0000-0000-000000000001', (select id from sale_lines limit 1), 100, 'user') $$,
  '%return_sale_line()%', 'direct sale_returns insert refused'
);
select throws_like(
  $$ update sale_lines set returned_at = now() where item_id = '00000000-0000-0000-0000-00000000c001' $$,
  '%append-only%', 'direct returned_at update refused'
);

-- 2. Return through the function.
select lives_ok(
  $$ select return_sale_line((select id from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 100, 'damaged') $$,
  'return recorded'
);
select isnt((select returned_at from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), null::timestamptz, 'sale line marked returned');
select is((select status from items where id = '00000000-0000-0000-0000-00000000c001'), 'for_sale'::item_status, 'item is for sale again');
select is((select sold_at from items where id = '00000000-0000-0000-0000-00000000c001'), null::timestamptz, 'sold_at cleared');
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 0.00::numeric, 'consignor credit reversed');
select is(
  (select entry_type from seller_ledger where id = (select ledger_reversal_id from sale_returns limit 1)),
  'reversal'::ledger_entry_type, 'return linked to its ledger reversal'
);
select is(
  (select count(*) from item_events where item_id = '00000000-0000-0000-0000-00000000c001' and from_status = 'sold' and to_status = 'for_sale'),
  1::bigint, 'sold -> for_sale audited'
);

-- 3. The same line cannot be returned twice.
select throws_like(
  $$ select return_sale_line((select id from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 100) $$,
  '%already returned%', 'double return refused'
);

-- 4. The item sells again; history keeps both lines.
select record_sale_line('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 80);
select is((select count(*) from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 2::bigint, 'two sale lines in history');
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 48.00::numeric, 'balance 48 after resale at 80');

select * from finish();
rollback;
