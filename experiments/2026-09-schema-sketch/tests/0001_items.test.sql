-- R1: an item is the consignor's property until sold — state machine + audit log
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into tenants (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'test', 'Test store');
insert into sellers (id, tenant_id, display_name)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Anna Consignor');

-- 1. Without an actor context no item can be created (audit row needs an actor).
select throws_like(
  $$ insert into items (tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Jug', 40, true, 100) $$,
  '%actor context required%',
  'insert without actor is rejected'
);

set local "komisio.actor_type" = 'user';
set local "komisio.actor_id" = 'test-user';

-- 2. With an actor the item is created, numbered and audited.
insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'Jug', 40, true, 100);
select is((select item_no from items where id = '00000000-0000-0000-0000-00000000c001'), 1::bigint, 'first item gets item_no 1');
select is((select count(*) from item_events where item_id = '00000000-0000-0000-0000-00000000c001' and event_type = 'created'), 1::bigint, 'created event logged');

-- 3. Regression: a priced item with only initial_price is accepted and gets current_price.
select lives_ok(
  $$ insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
     values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-0000000000a1', 'Vase', 40, true, 50, 'priced') $$,
  'priced item with only initial_price is accepted'
);
select is((select current_price from items where id = '00000000-0000-0000-0000-00000000c002'), 50.00::numeric, 'current_price defaults to initial_price');

-- 4. A commission item without commission terms violates the model check.
select throws_ok(
  $$ insert into items (tenant_id, seller_id, title, initial_price)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'No terms', 50) $$,
  '23514'
);

-- 5. Status is not writable directly.
select throws_like(
  $$ update items set status = 'priced' where id = '00000000-0000-0000-0000-00000000c001' $$,
  '%only through transition_item()%',
  'direct status update is rejected'
);

-- 6. Illegal transition received -> for_sale.
select throws_like(
  $$ select transition_item('00000000-0000-0000-0000-00000000c001', 'for_sale') $$,
  '%illegal item transition received -> for_sale%',
  'received -> for_sale is rejected'
);

-- 7. received -> priced with a reason is logged.
select lives_ok(
  $$ select transition_item('00000000-0000-0000-0000-00000000c001', 'priced', 'priced at intake') $$,
  'received -> priced'
);
select is(
  (select reason from item_events where item_id = '00000000-0000-0000-0000-00000000c001' and event_type = 'status_change'),
  'priced at intake', 'status change logged with reason'
);

-- 8. A direct price change is allowed and audited.
update items set current_price = 120 where id = '00000000-0000-0000-0000-00000000c001';
select is(
  (select to_price from item_events where item_id = '00000000-0000-0000-0000-00000000c001' and event_type = 'price_change'),
  120.00::numeric, 'price change logged'
);

-- 9. 'sold' is not reachable through transition_item().
select throws_like(
  $$ select transition_item('00000000-0000-0000-0000-00000000c001', 'sold') $$,
  '%record_sale_line()%', 'sold only through a sale'
);

-- 10. Ownership is immutable; items are never deleted.
select throws_like(
  $$ update items set seller_id = null where id = '00000000-0000-0000-0000-00000000c001' $$,
  '%immutable%', 'seller_id cannot change'
);
select throws_like(
  $$ delete from items where id = '00000000-0000-0000-0000-00000000c001' $$,
  '%never deleted%', 'delete is rejected'
);

select * from finish();
rollback;
