-- New price facts must have a strict per-item order, even in one transaction.
-- Do not rewrite historical price rows or derive chronology from random UUIDs.
create function komisio_private.order_new_item_price() returns trigger
language plpgsql security definer set search_path='' as $$
declare latest timestamptz;
begin
 perform 1 from public.tenants where id=new.tenant_id for update;
 select max(set_at) into latest from public.item_prices
 where tenant_id=new.tenant_id and item_id=new.item_id;
 new.set_at:=greatest(clock_timestamp(),latest+interval '1 microsecond');
 return new;
end $$;
revoke all on function komisio_private.order_new_item_price() from public,anon,authenticated;
create trigger item_prices_order before insert on public.item_prices
 for each row execute function komisio_private.order_new_item_price();
