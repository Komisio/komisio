-- Sales: record_sale_line() is the only way to sold; VAT treatment is derived
-- from the sales model and frozen with its basis (DECISIONS.md #8)
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into tenants (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'test', 'Test store');
insert into sellers (id, tenant_id, display_name)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Anna Consignor');

set local "komisio.actor_type" = 'agent';
set local "komisio.actor_id" = 'apikey:zettle-sync';

insert into sales (id, tenant_id, channel, external_ref, payment_method)
  values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'pos', 'zettle-1', 'card');

-- Commission item, 40 % inclusive of VAT, sold for 100.
insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'Jug', 40, true, 100, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c001', 'for_sale');

-- 1. Direct insert into sale_lines is refused.
select throws_like(
  $$ insert into sale_lines (tenant_id, sale_id, item_id, price)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100) $$,
  '%record_sale_line()%', 'direct sale_lines insert is refused'
);

-- 2. Through the function: sold, commission 40, VAT 8, share 60.
select lives_ok(
  $$ select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100) $$,
  'sale recorded'
);
select is((select status from items where id = '00000000-0000-0000-0000-00000000c001'), 'sold'::item_status, 'item is sold');
select is((select vat_treatment from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 'commission_vat'::vat_treatment, 'treatment commission_vat');
select is((select commission_amount from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 40.00::numeric, 'commission 40 incl VAT');
select is((select commission_vat from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 8.00::numeric, 'VAT on commission 8');
select is((select vat_amount from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 8.00::numeric, 'vat_amount = commission VAT');
select is((select seller_share from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), 60.00::numeric, 'consignor share 60');
select is((select vat_basis ->> 'commission_pct' from sale_lines where item_id = '00000000-0000-0000-0000-00000000c001'), '40.00', 'basis frozen on the line');
select is((select total_amount from sales where id = '00000000-0000-0000-0000-00000000d001'), 100.00::numeric, 'sale total updated');
select is((select balance from seller_balances where seller_id = '00000000-0000-0000-0000-0000000000a1'), 60.00::numeric, 'ledger balance 60');
select is(
  (select actor_id from seller_ledger where seller_id = '00000000-0000-0000-0000-0000000000a1' and entry_type = 'sale_credit'),
  'apikey:zettle-sync', 'ledger row carries the agent identity'
);

-- 3. The same item cannot be sold again while sold.
select throws_ok(
  $$ select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100) $$,
  'P0001'
);

-- 4. The ledger is append-only and not directly writable.
select throws_like(
  $$ update seller_ledger set amount = 999 where seller_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '%append-only%', 'ledger update refused'
);
select throws_like(
  $$ insert into seller_ledger (tenant_id, seller_id, entry_type, amount, actor_type)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'sale_credit', 10, 'user') $$,
  '%written only by%', 'direct ledger insert refused'
);

-- 5. Commission stated exclusive of VAT: net 40, VAT 10, fee 50, share 50.
insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
  values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'Lamp', 40, false, 100, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c002', 'for_sale');
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c002', 100);
select is((select commission_amount from sale_lines where item_id = '00000000-0000-0000-0000-00000000c002'), 50.00::numeric, 'commission excl VAT: fee 50 incl VAT');
select is((select seller_share from sale_lines where item_id = '00000000-0000-0000-0000-00000000c002'), 50.00::numeric, 'commission excl VAT: share 50');

-- 6. Store-owned, margin-scheme eligible: margin 180, VAT 36, no ledger row.
insert into items (id, tenant_id, ownership, sales_model, title, initial_price, vmb_purchase_price, vmb_eligible, status)
  values ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-000000000001',
          'store_owned', 'purchase_resale', 'Bought chair', 300, 120, true, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c003', 'for_sale');
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c003', 300);
select is((select vat_treatment from sale_lines where item_id = '00000000-0000-0000-0000-00000000c003'), 'margin_scheme'::vat_treatment, 'margin scheme applied');
select is((select vat_amount from sale_lines where item_id = '00000000-0000-0000-0000-00000000c003'), 36.00::numeric, 'VAT on margin 180 = 36');

-- 7. Store-owned but not eligible: standard VAT on the full price.
insert into items (id, tenant_id, ownership, sales_model, title, initial_price, vmb_purchase_price, vmb_eligible, status)
  values ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-000000000001',
          'store_owned', 'purchase_resale', 'Bought table', 200, 150, false, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c004', 'for_sale');
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c004', 200);
select is((select vat_treatment from sale_lines where item_id = '00000000-0000-0000-0000-00000000c004'), 'standard_vat'::vat_treatment, 'standard VAT when not eligible');
select is((select vat_amount from sale_lines where item_id = '00000000-0000-0000-0000-00000000c004'), 40.00::numeric, 'VAT 40 on 200');

select * from finish();
rollback;
