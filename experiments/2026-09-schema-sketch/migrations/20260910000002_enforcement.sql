-- Komisio — phase 0: enforcement (rules, functions, triggers)
--
-- The write model, in one paragraph: application roles get column-level
-- INSERT/UPDATE grants on the few columns they may touch directly (see
-- 20260910000003_access_control.sql). Every state change with financial
-- consequence — item status, recording a sale, a customer return, ledger
-- entries, payout status, issuing or crediting a settlement — happens only
-- through the SECURITY DEFINER functions in this file. Those functions verify
-- membership and role themselves, then set a transaction-local internal flag
-- that the triggers require. The flag is not the security boundary (anyone can
-- call set_config); the grants are. The triggers are the second line of
-- defence and the place where the rule is written down in one spot.
--
-- Rules R1–R4 are documented in docs/DECISIONS.md and proven by supabase/tests.
--   R1  An item is the consignor's property until sold. Status changes only
--       through transition_item(); 'sold' only through record_sale_line();
--       'sold' → 'for_sale' only through return_sale_line(). Every status and
--       price change is logged with an identified actor.
--   R2  The consignor ledger is append-only and only written by functions in
--       this file. A payout can never exceed the consignor's balance
--       (checked under an advisory lock per consignor).
--   R3  A settlement is numbered sequentially per tenant at issue, is immutable
--       afterwards, and is corrected by a credit note. A ledger entry can be
--       covered by at most one live settlement — verified with row locks at
--       issue time, not only at draft time.
--   R4  Audit logs and documents behind issued settlements or signed
--       agreements cannot be changed or deleted.

-- ---------------------------------------------------------------------------
-- Request context helpers
-- ---------------------------------------------------------------------------

-- JWT claims as set by PostgREST/Supabase (request.jwt.claims). Empty when
-- absent, so callers can use ->> without a cast error.
create or replace function jwt_claims()
returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function current_user_id()
returns uuid language sql stable
as $$ select nullif(jwt_claims() ->> 'sub', '')::uuid $$;

-- service_role requests and superuser sessions (tests, migrations) bypass
-- membership checks. Everything else must be a member.
create or replace function is_privileged()
returns boolean language sql stable
as $$
  select jwt_claims() ->> 'role' = 'service_role'
      or exists (select 1 from pg_roles where rolname = session_user and rolsuper)
$$;

-- Membership lookup. SECURITY DEFINER so it can read tenant_members without
-- recursing into that table's own RLS.
create or replace function user_tenant_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$ select tenant_id from tenant_members where user_id = current_user_id() $$;

create or replace function tenant_role(p_tenant uuid)
returns text language sql stable security definer set search_path = public
as $$ select role from tenant_members where tenant_id = p_tenant and user_id = current_user_id() $$;

create or replace function assert_can_write(p_tenant uuid)
returns void language plpgsql stable
as $$
begin
  if is_privileged() then return; end if;
  if coalesce(tenant_role(p_tenant), '') not in ('owner', 'staff') then
    raise exception 'komisio: not permitted to write in tenant %', p_tenant
      using errcode = '42501';
  end if;
end;
$$;

-- Actor identity for audit rows. The application/MCP server sets, per
-- transaction:
--   select set_config('komisio.actor_type', 'agent', true);
--   select set_config('komisio.actor_id',   'apikey:abc123', true);
-- Without that, the JWT subject is used as 'user'. Without either, the write
-- is rejected: anonymous writes to items, ledger or payouts do not exist.
create or replace function current_actor(out a_type actor_type, out a_id text)
language plpgsql stable
as $$
declare
  t text := nullif(current_setting('komisio.actor_type', true), '');
  i text := nullif(current_setting('komisio.actor_id', true), '');
  uid uuid := current_user_id();
begin
  if t is not null then
    a_type := t::actor_type;
    a_id := i;
    return;
  end if;
  if uid is not null then
    a_type := 'user';
    a_id := uid::text;
    return;
  end if;
  raise exception 'komisio: actor context required (set komisio.actor_type/komisio.actor_id)'
    using errcode = 'P0001';
end;
$$;

-- Internal flags. Transaction-local, explicitly reset after use. Only honoured
-- when the current user is not an application role, so an application role
-- that sets the flag itself gains nothing.
create or replace function internal_flag(p_name text)
returns boolean language sql stable
as $$
  select coalesce(nullif(current_setting('komisio.internal_' || p_name, true), '') = 'on', false)
     and current_user not in ('authenticated', 'anon')
$$;

create or replace function set_internal(p_name text, p_on boolean)
returns void language sql
as $$ select set_config('komisio.internal_' || p_name, case when p_on then 'on' else 'off' end, true) $$;

-- Per-tenant counters. SECURITY DEFINER: application roles have no access to
-- tenant_counters at all.
create or replace function next_counter(p_tenant uuid, p_name text)
returns bigint language plpgsql security definer set search_path = public
as $$
declare
  v bigint;
begin
  insert into tenant_counters (tenant_id, name, value)
  values (p_tenant, p_name, 1)
  on conflict (tenant_id, name)
  do update set value = tenant_counters.value + 1
  returning value into v;
  return v;
end;
$$;

-- Generic guards.
create or replace function forbid_change()
returns trigger language plpgsql
as $$
begin
  raise exception 'komisio: % is append-only (corrections are new rows)', tg_table_name;
end;
$$;

create or replace function forbid_delete()
returns trigger language plpgsql
as $$
begin
  raise exception 'komisio: rows in % are never deleted', tg_table_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenants and membership
-- ---------------------------------------------------------------------------

-- The creator becomes the first owner. SECURITY DEFINER because the creator is
-- not yet a member when the membership policy would be evaluated.
create or replace function tenants_after_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into tenant_members (tenant_id, user_id, role) values (new.id, new.created_by, 'owner');
  end if;
  return new;
end;
$$;

create trigger tenants_after_insert after insert on tenants
  for each row execute function tenants_after_insert();

-- A tenant always keeps at least one owner.
create or replace function tenant_members_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if (select count(*) from tenant_members where tenant_id = old.tenant_id and role = 'owner') <= 1 then
      raise exception 'komisio: cannot remove the last owner of tenant %', old.tenant_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger tenant_members_guard before update or delete on tenant_members
  for each row execute function tenant_members_guard();

-- ---------------------------------------------------------------------------
-- R1: items
-- ---------------------------------------------------------------------------

create or replace function item_transition_allowed(f item_status, t item_status)
returns boolean language sql immutable
as $$
  select case
    when f = t then true
    when f = 'received'  and t in ('priced', 'withdrawn')                                    then true
    when f = 'priced'    and t in ('for_sale', 'returned_to_seller', 'withdrawn')            then true
    when f = 'for_sale'  and t in ('sold', 'expired', 'returned_to_seller', 'withdrawn')     then true
    when f = 'expired'   and t in ('for_sale', 'returned_to_seller', 'donated', 'withdrawn') then true
    when f = 'sold'      and t = 'for_sale'                                                  then true  -- customer return only
    else false
  end
$$;

create or replace function items_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.current_price is null then
    new.current_price := new.initial_price;
  end if;
  if new.status not in ('received', 'priced') then
    raise exception 'komisio: new items start as received or priced, not %', new.status;
  end if;
  if new.status = 'priced' and new.current_price is null then
    raise exception 'komisio: priced item needs a price';
  end if;
  if new.item_no is null then
    new.item_no := next_counter(new.tenant_id, 'item_no');
  end if;
  return new;
end;
$$;

create trigger items_before_insert before insert on items
  for each row execute function items_before_insert();

create or replace function items_before_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.tenant_id <> old.tenant_id or new.item_no <> old.item_no
     or new.ownership <> old.ownership or new.sales_model <> old.sales_model
     or new.seller_id is distinct from old.seller_id then
    raise exception 'komisio: item identity/ownership is immutable (item_no %)', old.item_no;
  end if;

  if new.status <> old.status then
    if not internal_flag('transition') then
      raise exception 'komisio: item status changes only through transition_item() (item_no %)', old.item_no;
    end if;
    if not item_transition_allowed(old.status, new.status) then
      raise exception 'komisio: illegal item transition % -> % (item_no %)', old.status, new.status, old.item_no;
    end if;
    if new.status = 'sold' and not internal_flag('sale') then
      raise exception 'komisio: status sold is set only by record_sale_line() (item_no %)', old.item_no;
    end if;
    if old.status = 'sold' and not internal_flag('return') then
      raise exception 'komisio: a sold item leaves sold only through return_sale_line() (item_no %)', old.item_no;
    end if;
  end if;

  -- A sold item is frozen (except the return path above).
  if old.status = 'sold' and not internal_flag('return') and (
       new.current_price is distinct from old.current_price
    or new.commission_pct is distinct from old.commission_pct
    or new.commission_incl_vat is distinct from old.commission_incl_vat
    or new.vmb_purchase_price is distinct from old.vmb_purchase_price
    or new.vmb_eligible <> old.vmb_eligible
  ) then
    raise exception 'komisio: a sold item is frozen (item_no %)', old.item_no;
  end if;

  -- Commission terms are frozen once the item is on the floor.
  if old.status in ('for_sale', 'expired', 'sold') and (
       new.commission_pct is distinct from old.commission_pct
    or new.commission_incl_vat is distinct from old.commission_incl_vat
  ) then
    raise exception 'komisio: commission terms are frozen once the item is for sale (item_no %)', old.item_no;
  end if;

  if new.status in ('priced', 'for_sale') and new.current_price is null then
    raise exception 'komisio: item needs a price before status % (item_no %)', new.status, old.item_no;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger items_before_update before update on items
  for each row execute function items_before_update();

-- Audit log, written by the database. Never by the application.
create or replace function items_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor record;
  reason text := nullif(current_setting('komisio.reason', true), '');
begin
  select * into actor from current_actor();

  if tg_op = 'INSERT' then
    insert into item_events (tenant_id, item_id, event_type, to_status, to_price, actor_type, actor_id, reason)
    values (new.tenant_id, new.id, 'created', new.status, new.current_price, actor.a_type, actor.a_id, reason);
    return new;
  end if;

  if new.status <> old.status then
    insert into item_events (tenant_id, item_id, event_type, from_status, to_status, actor_type, actor_id, reason)
    values (new.tenant_id, new.id, 'status_change', old.status, new.status, actor.a_type, actor.a_id, reason);
  end if;

  if new.current_price is distinct from old.current_price then
    insert into item_events (tenant_id, item_id, event_type, from_price, to_price, actor_type, actor_id, reason)
    values (new.tenant_id, new.id, 'price_change', old.current_price, new.current_price, actor.a_type, actor.a_id, reason);
  end if;

  return new;
end;
$$;

create trigger items_audit after insert or update on items
  for each row execute function items_audit();

create trigger items_no_delete before delete on items
  for each row execute function forbid_delete();

create trigger item_events_append_only before update or delete on item_events
  for each row execute function forbid_change();

-- Public API: change an item's status. 'sold' and the return path are refused
-- here; they have their own functions.
create or replace function transition_item(p_item uuid, p_status item_status, p_reason text default null)
returns items language plpgsql security definer set search_path = public
as $$
declare
  it items%rowtype;
begin
  select * into it from items where id = p_item for update;
  if not found then raise exception 'komisio: unknown item'; end if;
  perform assert_can_write(it.tenant_id);
  if p_status = 'sold' then
    raise exception 'komisio: use record_sale_line() to sell an item';
  end if;
  if it.status = 'sold' then
    raise exception 'komisio: use return_sale_line() to take a sold item back';
  end if;
  if p_reason is not null then
    perform set_config('komisio.reason', p_reason, true);
  end if;
  perform set_internal('transition', true);
  update items set status = p_status where id = p_item returning * into it;
  perform set_internal('transition', false);
  return it;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales: record_sale_line() is the only way to 'sold' and to a sale credit
-- ---------------------------------------------------------------------------

create or replace function sale_lines_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  it items%rowtype;
  tn tenants%rowtype;
  sl_sale sales%rowtype;
  r numeric(5,2);
  commission_net numeric(12,2);
begin
  if not internal_flag('sale') then
    raise exception 'komisio: sale lines are recorded only through record_sale_line()';
  end if;

  select * into it from items where id = new.item_id for update;
  if not found then raise exception 'komisio: unknown item'; end if;
  select * into sl_sale from sales where id = new.sale_id;
  if not found then raise exception 'komisio: unknown sale'; end if;
  if it.tenant_id <> new.tenant_id or sl_sale.tenant_id <> new.tenant_id then
    raise exception 'komisio: item, sale and line must belong to the same tenant';
  end if;
  if it.status not in ('for_sale', 'expired') then
    raise exception 'komisio: item % is not for sale (status %)', it.item_no, it.status;
  end if;

  select * into tn from tenants where id = new.tenant_id;
  new.vat_rule_version := 'komisio-vat-v0';

  if it.sales_model = 'commission' then
    r := tn.commission_vat_pct;
    new.vat_treatment  := 'commission_vat';
    new.commission_pct := it.commission_pct;
    if it.commission_incl_vat then
      -- Commission stated inclusive of VAT towards the consignor.
      new.commission_amount := round(new.price * it.commission_pct / 100, 2);
      new.commission_vat    := round(new.commission_amount * r / (100 + r), 2);
    else
      -- Commission stated exclusive of VAT; VAT is added on top.
      commission_net        := round(new.price * it.commission_pct / 100, 2);
      new.commission_vat    := round(commission_net * r / 100, 2);
      new.commission_amount := commission_net + new.commission_vat;
    end if;
    new.seller_share := new.price - new.commission_amount;
    new.vat_amount   := new.commission_vat;
    new.vmb_margin   := null;
    new.vat_basis    := jsonb_build_object(
      'price', new.price, 'commission_pct', it.commission_pct,
      'commission_incl_vat', it.commission_incl_vat, 'vat_pct', r);
  else
    if it.vmb_eligible then
      r := tn.standard_vat_pct;
      new.vat_treatment := 'margin_scheme';
      new.vmb_margin    := new.price - it.vmb_purchase_price;
      -- Margin scheme: VAT on a positive margin only; a negative margin gives no VAT.
      new.vat_amount    := case when new.vmb_margin > 0 then round(new.vmb_margin * r / (100 + r), 2) else 0 end;
      new.vat_basis     := jsonb_build_object(
        'price', new.price, 'purchase_price', it.vmb_purchase_price, 'vat_pct', r);
    else
      r := tn.standard_vat_pct;
      new.vat_treatment := 'standard_vat';
      new.vmb_margin    := null;
      new.vat_amount    := round(new.price * r / (100 + r), 2);
      new.vat_basis     := jsonb_build_object('price', new.price, 'vat_pct', r);
    end if;
    new.commission_pct    := null;
    new.commission_amount := null;
    new.commission_vat    := null;
    new.seller_share      := null;
  end if;

  return new;
end;
$$;

create trigger sale_lines_before_insert before insert on sale_lines
  for each row execute function sale_lines_before_insert();

create or replace function sale_lines_after_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  it items%rowtype;
  actor record;
  sold_at_ts timestamptz;
begin
  select * into it from items where id = new.item_id;
  select sold_at into sold_at_ts from sales where id = new.sale_id;
  select * into actor from current_actor();

  perform set_internal('transition', true);
  update items set status = 'sold', sold_at = sold_at_ts, current_price = new.price where id = new.item_id;
  perform set_internal('transition', false);

  if new.vat_treatment = 'commission_vat' then
    perform set_internal('ledger', true);
    insert into seller_ledger (tenant_id, seller_id, entry_type, amount, ref_type, ref_id, actor_type, actor_id, occurred_at)
    values (new.tenant_id, it.seller_id, 'sale_credit', new.seller_share, 'sale_line', new.id, actor.a_type, actor.a_id, sold_at_ts);
    perform set_internal('ledger', false);
  end if;

  update sales set total_amount = total_amount + new.price where id = new.sale_id;
  return new;
end;
$$;

create trigger sale_lines_after_insert after insert on sale_lines
  for each row execute function sale_lines_after_insert();

-- The only permitted change to a sale line is marking it returned, and only
-- through return_sale_line().
create or replace function sale_lines_before_update()
returns trigger language plpgsql
as $$
begin
  if internal_flag('return')
     and old.returned_at is null and new.returned_at is not null
     and new.id = old.id and new.tenant_id = old.tenant_id and new.sale_id = old.sale_id
     and new.item_id = old.item_id and new.price = old.price
     and new.vat_treatment = old.vat_treatment and new.vat_amount = old.vat_amount
     and new.seller_share is not distinct from old.seller_share then
    return new;
  end if;
  raise exception 'komisio: sale_lines is append-only (a return is recorded with return_sale_line())';
end;
$$;

create trigger sale_lines_before_update before update on sale_lines
  for each row execute function sale_lines_before_update();

create trigger sale_lines_no_delete before delete on sale_lines
  for each row execute function forbid_delete();

create or replace function record_sale_line(p_sale uuid, p_item uuid, p_price numeric)
returns sale_lines language plpgsql security definer set search_path = public
as $$
declare
  s sales%rowtype;
  line sale_lines%rowtype;
begin
  select * into s from sales where id = p_sale;
  if not found then raise exception 'komisio: unknown sale'; end if;
  perform assert_can_write(s.tenant_id);
  perform set_internal('sale', true);
  insert into sale_lines (tenant_id, sale_id, item_id, price)
  values (s.tenant_id, p_sale, p_item, p_price)
  returning * into line;
  perform set_internal('sale', false);
  return line;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer returns: the sale stays in history, the consignor's credit is
-- reversed, and the item becomes sellable again.
-- ---------------------------------------------------------------------------

create or replace function sale_returns_before_insert()
returns trigger language plpgsql
as $$
begin
  if not internal_flag('return') then
    raise exception 'komisio: returns are recorded only through return_sale_line()';
  end if;
  return new;
end;
$$;

create trigger sale_returns_before_insert before insert on sale_returns
  for each row execute function sale_returns_before_insert();

create trigger sale_returns_immutable before update or delete on sale_returns
  for each row execute function forbid_change();

create or replace function return_sale_line(p_sale_line uuid, p_refund numeric, p_reason text default null)
returns sale_returns language plpgsql security definer set search_path = public
as $$
declare
  line sale_lines%rowtype;
  credit seller_ledger%rowtype;
  actor record;
  rev_id bigint;
  ret sale_returns%rowtype;
begin
  select * into line from sale_lines where id = p_sale_line for update;
  if not found then raise exception 'komisio: unknown sale line'; end if;
  perform assert_can_write(line.tenant_id);
  if line.returned_at is not null then
    raise exception 'komisio: sale line % is already returned', p_sale_line;
  end if;
  select * into actor from current_actor();

  perform set_internal('return', true);
  update sale_lines set returned_at = now() where id = p_sale_line;

  if line.vat_treatment = 'commission_vat' then
    select * into credit from seller_ledger
     where ref_type = 'sale_line' and ref_id = line.id and entry_type = 'sale_credit'
     for update;
    if not found then raise exception 'komisio: sale credit for line % not found', p_sale_line; end if;
    perform set_internal('ledger', true);
    insert into seller_ledger (tenant_id, seller_id, entry_type, amount, ref_type, ref_id, reverses_entry_id, note, actor_type, actor_id)
    values (line.tenant_id, credit.seller_id, 'reversal', -credit.amount, 'sale_return', line.id, credit.id,
            coalesce('customer return: ' || p_reason, 'customer return'), actor.a_type, actor.a_id)
    returning id into rev_id;
    perform set_internal('ledger', false);
  end if;

  if p_reason is not null then
    perform set_config('komisio.reason', 'customer return: ' || p_reason, true);
  end if;
  perform set_internal('transition', true);
  update items set status = 'for_sale', sold_at = null where id = line.item_id;
  perform set_internal('transition', false);

  insert into sale_returns (tenant_id, sale_line_id, refund_amount, reason, ledger_reversal_id, actor_type, actor_id)
  values (line.tenant_id, line.id, p_refund, p_reason, rev_id, actor.a_type, actor.a_id)
  returning * into ret;
  perform set_internal('return', false);
  return ret;
end;
$$;

-- ---------------------------------------------------------------------------
-- R2: consignor ledger
-- ---------------------------------------------------------------------------

create or replace function seller_ledger_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  orig seller_ledger%rowtype;
begin
  if not internal_flag('ledger') then
    raise exception 'komisio: ledger entries are written only by record_sale_line(), return_sale_line(), transition_payout() and post_ledger_adjustment()';
  end if;
  if new.entry_type = 'sale_credit' and new.amount <= 0 then
    raise exception 'komisio: sale_credit must be positive';
  end if;
  if new.entry_type in ('payout', 'fee') and new.amount >= 0 then
    raise exception 'komisio: % must be negative', new.entry_type;
  end if;
  if new.entry_type = 'reversal' then
    select * into orig from seller_ledger where id = new.reverses_entry_id;
    if not found or orig.seller_id <> new.seller_id or orig.tenant_id <> new.tenant_id then
      raise exception 'komisio: reversal must reference an entry for the same consignor';
    end if;
    if new.amount <> -orig.amount then
      raise exception 'komisio: reversal amount must be exactly the negated original (% vs %)', new.amount, orig.amount;
    end if;
  end if;
  return new;
end;
$$;

create trigger seller_ledger_before_insert before insert on seller_ledger
  for each row execute function seller_ledger_before_insert();

create trigger seller_ledger_append_only before update or delete on seller_ledger
  for each row execute function forbid_change();

create or replace function post_ledger_adjustment(p_seller uuid, p_amount numeric, p_note text)
returns seller_ledger language plpgsql security definer set search_path = public
as $$
declare
  s sellers%rowtype;
  actor record;
  e seller_ledger%rowtype;
begin
  select * into s from sellers where id = p_seller;
  if not found then raise exception 'komisio: unknown consignor'; end if;
  perform assert_can_write(s.tenant_id);
  select * into actor from current_actor();
  perform set_internal('ledger', true);
  insert into seller_ledger (tenant_id, seller_id, entry_type, amount, note, actor_type, actor_id)
  values (s.tenant_id, s.id, 'adjustment', p_amount, p_note, actor.a_type, actor.a_id)
  returning * into e;
  perform set_internal('ledger', false);
  return e;
end;
$$;

-- ---------------------------------------------------------------------------
-- R2: payouts — never above the balance
-- ---------------------------------------------------------------------------

create or replace function payout_transition_allowed(f payout_status, t payout_status)
returns boolean language sql immutable
as $$
  select case
    when f = t then true
    when f = 'pending'  and t in ('approved', 'cancelled')          then true
    when f = 'approved' and t in ('sent', 'cancelled', 'failed')    then true
    when f = 'sent'     and t in ('confirmed', 'failed')            then true
    else false
  end
$$;

-- New payouts always start pending, with nothing reserved.
create or replace function payouts_before_insert()
returns trigger language plpgsql
as $$
begin
  if new.status <> 'pending' or new.ledger_entry_id is not null or new.reversal_entry_id is not null
     or new.approved_at is not null or new.approved_by is not null then
    raise exception 'komisio: payouts are created as pending; use transition_payout() to approve';
  end if;
  return new;
end;
$$;

create trigger payouts_before_insert before insert on payouts
  for each row execute function payouts_before_insert();

create or replace function payouts_before_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  bal numeric(12,2);
  actor record;
  entry_id bigint;
begin
  if new.tenant_id <> old.tenant_id or new.seller_id <> old.seller_id or new.amount <> old.amount
     or new.ledger_entry_id is distinct from old.ledger_entry_id and not internal_flag('payout')
     or new.reversal_entry_id is distinct from old.reversal_entry_id and not internal_flag('payout') then
    raise exception 'komisio: payout tenant/seller/amount/ledger links are immutable';
  end if;

  if new.status <> old.status then
    if not internal_flag('payout') then
      raise exception 'komisio: payout status changes only through transition_payout()';
    end if;
    if not payout_transition_allowed(old.status, new.status) then
      raise exception 'komisio: illegal payout transition % -> %', old.status, new.status;
    end if;
    select * into actor from current_actor();

    -- pending → approved: reserve the funds; never above the balance.
    if old.status = 'pending' and new.status = 'approved' then
      perform pg_advisory_xact_lock(hashtext(new.seller_id::text));
      select coalesce(sum(amount), 0) into bal from seller_ledger where seller_id = new.seller_id;
      if bal < new.amount then
        raise exception 'komisio: payout % exceeds consignor balance % (seller %)', new.amount, bal, new.seller_id
          using errcode = 'P0002';
      end if;
      perform set_internal('ledger', true);
      insert into seller_ledger (tenant_id, seller_id, entry_type, amount, ref_type, ref_id, actor_type, actor_id)
      values (new.tenant_id, new.seller_id, 'payout', -new.amount, 'payout', new.id, actor.a_type, actor.a_id)
      returning id into entry_id;
      perform set_internal('ledger', false);
      new.ledger_entry_id := entry_id;
      new.approved_at := now();
      new.approved_by := actor.a_id;
    end if;

    -- approved/sent → failed/cancelled: reverse the reservation.
    if old.status in ('approved', 'sent') and new.status in ('failed', 'cancelled') then
      perform set_internal('ledger', true);
      insert into seller_ledger (tenant_id, seller_id, entry_type, amount, ref_type, ref_id, reverses_entry_id, note, actor_type, actor_id)
      values (new.tenant_id, new.seller_id, 'reversal', new.amount, 'payout', new.id, old.ledger_entry_id,
              'payout ' || new.status, actor.a_type, actor.a_id)
      returning id into entry_id;
      perform set_internal('ledger', false);
      new.reversal_entry_id := entry_id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger payouts_before_update before update on payouts
  for each row execute function payouts_before_update();

create trigger payouts_no_delete before delete on payouts
  for each row execute function forbid_delete();

create or replace function transition_payout(p_payout uuid, p_status payout_status, p_external_ref text default null)
returns payouts language plpgsql security definer set search_path = public
as $$
declare
  p payouts%rowtype;
begin
  select * into p from payouts where id = p_payout for update;
  if not found then raise exception 'komisio: unknown payout'; end if;
  perform assert_can_write(p.tenant_id);
  perform set_internal('payout', true);
  update payouts
     set status = p_status, external_ref = coalesce(p_external_ref, external_ref)
   where id = p_payout
  returning * into p;
  perform set_internal('payout', false);
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- R3: settlements
-- ---------------------------------------------------------------------------

-- New settlements always start as empty drafts. A credit note may only be
-- created by credit_settlement().
create or replace function settlements_before_insert()
returns trigger language plpgsql
as $$
begin
  if new.status <> 'draft' or new.settlement_no is not null or new.issued_at is not null
     or new.total_credits is not null or new.total_debits is not null or new.net_amount is not null
     or new.credited_by_settlement_id is not null then
    raise exception 'komisio: settlements are created as drafts; use issue_settlement()';
  end if;
  if new.credits_settlement_id is not null and not internal_flag('settlement') then
    raise exception 'komisio: credit notes are created only by credit_settlement()';
  end if;
  return new;
end;
$$;

create trigger settlements_before_insert before insert on settlements
  for each row execute function settlements_before_insert();

create or replace function settlements_before_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  credits numeric(12,2);
  debits numeric(12,2);
begin
  if new.tenant_id <> old.tenant_id or new.seller_id <> old.seller_id then
    raise exception 'komisio: settlement tenant/seller are immutable';
  end if;

  if old.status = 'issued' then
    if internal_flag('settlement')
       and new.status = 'credited' and new.credited_by_settlement_id is not null
       and new.settlement_no = old.settlement_no and new.issued_at = old.issued_at
       and new.total_credits = old.total_credits and new.total_debits = old.total_debits
       and new.net_amount = old.net_amount
       and new.period_from is not distinct from old.period_from
       and new.period_to is not distinct from old.period_to
       and new.document_id is not distinct from old.document_id then
      return new;
    end if;
    raise exception 'komisio: issued settlement % is immutable (credit it instead)', old.settlement_no;
  end if;

  if old.status = 'credited' then
    raise exception 'komisio: credited settlement % is immutable', old.settlement_no;
  end if;

  -- draft
  if new.status <> old.status then
    if not internal_flag('settlement') then
      raise exception 'komisio: settlement status changes only through issue_settlement()/credit_settlement()';
    end if;
    if new.status <> 'issued' then
      raise exception 'komisio: a draft can only be issued';
    end if;
    select coalesce(sum(case when l.amount * e.sign > 0 then l.amount * e.sign else 0 end), 0),
           coalesce(sum(case when l.amount * e.sign < 0 then -l.amount * e.sign else 0 end), 0)
      into credits, debits
      from settlement_entries e join seller_ledger l on l.id = e.ledger_entry_id
     where e.settlement_id = new.id;
    if credits = 0 and debits = 0 then
      raise exception 'komisio: cannot issue an empty settlement';
    end if;
    new.settlement_no := next_counter(new.tenant_id, 'settlement_no');
    new.issued_at     := now();
    new.total_credits := credits;
    new.total_debits  := debits;
    new.net_amount    := credits - debits;
  elsif new.settlement_no is not null or new.issued_at is not null or new.total_credits is not null
     or new.total_debits is not null or new.net_amount is not null or new.credited_by_settlement_id is not null then
    raise exception 'komisio: number and totals of a draft are assigned by issue_settlement()';
  end if;

  return new;
end;
$$;

create trigger settlements_before_update before update on settlements
  for each row execute function settlements_before_update();

create or replace function settlements_before_delete()
returns trigger language plpgsql
as $$
begin
  if old.status <> 'draft' then
    raise exception 'komisio: settlement % cannot be deleted (7-year retention)', old.settlement_no;
  end if;
  return old;
end;
$$;

create trigger settlements_before_delete before delete on settlements
  for each row execute function settlements_before_delete();

-- Draft-time check: right consignor, not already covered by an issued
-- settlement. The authoritative check is repeated under locks at issue time.
create or replace function settlement_entries_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  st settlements%rowtype;
  l seller_ledger%rowtype;
  live int;
begin
  select * into st from settlements where id = new.settlement_id for update;
  if st.status <> 'draft' then
    raise exception 'komisio: entries can only be added to a draft settlement';
  end if;
  select * into l from seller_ledger where id = new.ledger_entry_id;
  if not found or l.seller_id <> st.seller_id or l.tenant_id <> st.tenant_id then
    raise exception 'komisio: ledger entry % does not belong to this consignor', new.ledger_entry_id;
  end if;

  select coalesce(sum(sign), 0) into live
    from settlement_entries e join settlements s on s.id = e.settlement_id
   where e.ledger_entry_id = new.ledger_entry_id and s.status <> 'draft';

  if new.sign = 1 and live <> 0 then
    raise exception 'komisio: ledger entry % is already covered by an issued settlement', new.ledger_entry_id;
  end if;
  if new.sign = -1 then
    if not internal_flag('settlement') or st.credits_settlement_id is null then
      raise exception 'komisio: sign -1 entries are written only by credit_settlement()';
    end if;
    if not exists (select 1 from settlement_entries
                    where settlement_id = st.credits_settlement_id
                      and ledger_entry_id = new.ledger_entry_id and sign = 1) then
      raise exception 'komisio: entry % is not in the settlement being credited', new.ledger_entry_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger settlement_entries_before_insert before insert on settlement_entries
  for each row execute function settlement_entries_before_insert();

-- Entries are never moved between settlements; they can only be removed from a draft.
create trigger settlement_entries_no_update before update on settlement_entries
  for each row execute function forbid_change();

create or replace function settlement_entries_before_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (select status from settlements where id = old.settlement_id) <> 'draft' then
    raise exception 'komisio: entries of an issued settlement are immutable';
  end if;
  return old;
end;
$$;

create trigger settlement_entries_before_delete before delete on settlement_entries
  for each row execute function settlement_entries_before_delete();

-- Issue a draft. Locks every covered ledger entry and re-verifies, under those
-- locks, that no other issued settlement covers it. Two drafts covering the
-- same entry can therefore never both be issued.
create or replace function issue_settlement(p_settlement uuid)
returns settlements language plpgsql security definer set search_path = public
as $$
declare
  st settlements%rowtype;
  dup bigint;
begin
  select * into st from settlements where id = p_settlement for update;
  if not found then raise exception 'komisio: unknown settlement'; end if;
  perform assert_can_write(st.tenant_id);
  if st.status <> 'draft' then
    raise exception 'komisio: settlement is not a draft';
  end if;

  perform 1 from seller_ledger
   where id in (select ledger_entry_id from settlement_entries where settlement_id = p_settlement)
   order by id for update;

  select e.ledger_entry_id into dup
    from settlement_entries e
   where e.settlement_id = p_settlement and e.sign = 1
     and (select coalesce(sum(o.sign), 0)
            from settlement_entries o join settlements s on s.id = o.settlement_id
           where o.ledger_entry_id = e.ledger_entry_id and s.status <> 'draft') <> 0
   limit 1;
  if dup is not null then
    raise exception 'komisio: ledger entry % is already covered by an issued settlement', dup
      using errcode = 'P0003';
  end if;

  perform set_internal('settlement', true);
  update settlements set status = 'issued' where id = p_settlement returning * into st;
  perform set_internal('settlement', false);
  return st;
end;
$$;

-- Credit an issued settlement: creates a credit note with sign −1 for every
-- entry, issues it, and marks the original credited. Atomic.
create or replace function credit_settlement(p_settlement uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  orig settlements%rowtype;
  cn uuid;
begin
  select * into orig from settlements where id = p_settlement for update;
  if not found then raise exception 'komisio: unknown settlement'; end if;
  perform assert_can_write(orig.tenant_id);
  if orig.status <> 'issued' then
    raise exception 'komisio: only issued settlements can be credited';
  end if;
  perform set_internal('settlement', true);
  insert into settlements (tenant_id, seller_id, period_from, period_to, credits_settlement_id)
  values (orig.tenant_id, orig.seller_id, orig.period_from, orig.period_to, orig.id)
  returning id into cn;
  insert into settlement_entries (settlement_id, ledger_entry_id, sign)
  select cn, ledger_entry_id, -1 from settlement_entries where settlement_id = orig.id;
  update settlements set status = 'issued' where id = cn;
  update settlements set status = 'credited', credited_by_settlement_id = cn where id = orig.id;
  perform set_internal('settlement', false);
  return cn;
end;
$$;

-- ---------------------------------------------------------------------------
-- R4: documents behind issued settlements or signed agreements are kept
-- ---------------------------------------------------------------------------

create or replace function documents_before_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from settlements where document_id = old.id and status <> 'draft')
     or exists (select 1 from agreements where signed_document_id = old.id) then
    raise exception 'komisio: document % is referenced by a settlement or agreement (retention)', old.id;
  end if;
  return old;
end;
$$;

create trigger documents_before_delete before delete on documents
  for each row execute function documents_before_delete();

-- Sequential numbers for consignors and submissions.
create or replace function sellers_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.seller_no is null then
    new.seller_no := next_counter(new.tenant_id, 'seller_no');
  end if;
  return new;
end;
$$;

create trigger sellers_before_insert before insert on sellers
  for each row execute function sellers_before_insert();

create or replace function submissions_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.submission_no is null then
    new.submission_no := next_counter(new.tenant_id, 'submission_no');
  end if;
  return new;
end;
$$;

create trigger submissions_before_insert before insert on submissions
  for each row execute function submissions_before_insert();
