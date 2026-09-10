-- R3: settlements are numbered at issue, immutable afterwards, corrected by
-- credit note; a ledger entry is covered by at most one live settlement —
-- including the two-drafts case
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into tenants (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'test', 'Test store');
insert into sellers (id, tenant_id, display_name)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Anna Consignor');

set local "komisio.actor_type" = 'user';
set local "komisio.actor_id" = 'test-user';

-- Two sales -> two sale credits (60 + 30).
insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Jug',  40, true, 100, 'priced'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Vase', 40, true,  50, 'priced');
select transition_item('00000000-0000-0000-0000-00000000c001', 'for_sale');
select transition_item('00000000-0000-0000-0000-00000000c002', 'for_sale');
insert into sales (id, tenant_id, channel) values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'manual');
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 100);
select record_sale_line('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c002',  50);

-- 1. A settlement cannot be born issued.
select throws_like(
  $$ insert into settlements (tenant_id, seller_id, status, settlement_no, issued_at)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'issued', 99, now()) $$,
  '%created as drafts%', 'insert as issued is refused'
);

-- 2. Draft A with both entries, draft B with the first entry only.
insert into settlements (id, tenant_id, seller_id) values
  ('00000000-0000-0000-0000-00000000f00a', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000f00b', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1');

select throws_like(
  $$ select issue_settlement('00000000-0000-0000-0000-00000000f00a') $$,
  '%empty settlement%', 'empty draft cannot be issued'
);

insert into settlement_entries (settlement_id, ledger_entry_id)
  select '00000000-0000-0000-0000-00000000f00a', id from seller_ledger where seller_id = '00000000-0000-0000-0000-0000000000a1';
insert into settlement_entries (settlement_id, ledger_entry_id)
  values ('00000000-0000-0000-0000-00000000f00b', (select min(id) from seller_ledger));

-- 3. Status is not writable directly.
select throws_like(
  $$ update settlements set status = 'issued' where id = '00000000-0000-0000-0000-00000000f00a' $$,
  '%issue_settlement()%', 'direct status update is refused'
);

-- 4. Issue A: number 1, totals frozen.
select issue_settlement('00000000-0000-0000-0000-00000000f00a');
select is((select settlement_no from settlements where id = '00000000-0000-0000-0000-00000000f00a'), 1::bigint, 'A gets number 1');
select is((select total_credits from settlements where id = '00000000-0000-0000-0000-00000000f00a'), 90.00::numeric, 'credits 90');
select is((select net_amount from settlements where id = '00000000-0000-0000-0000-00000000f00a'), 90.00::numeric, 'net 90');

-- 5. Two drafts, same entry: issuing B after A must fail (P0003).
select throws_ok(
  $$ select issue_settlement('00000000-0000-0000-0000-00000000f00b') $$,
  'P0003'
);
select is((select status from settlements where id = '00000000-0000-0000-0000-00000000f00b'), 'draft'::settlement_status, 'B stays a draft');

-- 6. Issued A is immutable; entries cannot be moved or added.
select throws_like(
  $$ update settlements set net_amount = 1 where id = '00000000-0000-0000-0000-00000000f00a' $$,
  '%immutable%', 'issued settlement cannot change'
);
select throws_like(
  $$ delete from settlements where id = '00000000-0000-0000-0000-00000000f00a' $$,
  '%retention%', 'issued settlement cannot be deleted'
);
select throws_like(
  $$ update settlement_entries set settlement_id = '00000000-0000-0000-0000-00000000f00a'
      where settlement_id = '00000000-0000-0000-0000-00000000f00b' $$,
  '%append-only%', 'entries cannot be moved'
);
select throws_like(
  $$ insert into settlement_entries (settlement_id, ledger_entry_id)
     values ('00000000-0000-0000-0000-00000000f00a', (select max(id) from seller_ledger)) $$,
  '%only be added to a draft%', 'entries cannot be added to an issued settlement'
);

-- 7. Credit A: note number 2 with net -90; A is credited.
select lives_ok($$ select credit_settlement('00000000-0000-0000-0000-00000000f00a') $$, 'A can be credited');
select is((select status from settlements where id = '00000000-0000-0000-0000-00000000f00a'), 'credited'::settlement_status, 'A is credited');
select is(
  (select net_amount from settlements where credits_settlement_id = '00000000-0000-0000-0000-00000000f00a'),
  -90.00::numeric, 'credit note net -90'
);

-- 8. With A credited, B (covering the same entry) can now be issued: number 3.
select issue_settlement('00000000-0000-0000-0000-00000000f00b');
select is((select settlement_no from settlements where id = '00000000-0000-0000-0000-00000000f00b'), 3::bigint, 'B issued as number 3 once A is credited');

select * from finish();
rollback;
