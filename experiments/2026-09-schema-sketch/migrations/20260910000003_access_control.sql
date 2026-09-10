-- Komisio — phase 0: access control (RLS policies + grants)
--
-- Two layers, both required:
--   1. Row Level Security: a user sees and touches rows only in tenants where
--      tenant_members says they are a member. Membership is the only source
--      of access — a tenant id in a token means nothing on its own.
--      (See DECISIONS.md.)
--   2. Grants: application roles (authenticated) get column-level INSERT and
--      UPDATE on the few columns they may write directly. Everything with a
--      financial consequence is reachable only through the SECURITY DEFINER
--      functions in 20260910000002_enforcement.sql.
--
-- Roles: owner (everything incl. membership), staff (operations), readonly
-- (SELECT only). service_role bypasses RLS and is for trusted server jobs.

-- Supabase provides these roles; create them when running on plain Postgres.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_members', 'tenant_counters', 'sellers', 'agreements',
    'submissions', 'items', 'item_events', 'sales', 'sale_lines', 'sale_returns',
    'seller_ledger', 'settlements', 'settlement_entries', 'payouts',
    'pending_operations', 'documents'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end;
$$;

create or replace function can_write(p_tenant uuid)
returns boolean language sql stable
as $$ select coalesce(tenant_role(p_tenant), '') in ('owner', 'staff') $$;

create or replace function is_owner(p_tenant uuid)
returns boolean language sql stable
as $$ select coalesce(tenant_role(p_tenant), '') = 'owner' $$;

-- tenants: members read; the creator may insert (and becomes owner via
-- trigger); owners update; nobody deletes through the API.
create policy tenants_select on tenants for select using (id in (select user_tenant_ids()));
create policy tenants_insert on tenants for insert with check (created_by = current_user_id());
create policy tenants_update on tenants for update using (is_owner(id)) with check (is_owner(id));

-- tenant_members: members read; only owners administer membership.
-- (Owner-only by decision; see DECISIONS.md.)
create policy tenant_members_select on tenant_members for select using (tenant_id in (select user_tenant_ids()));
create policy tenant_members_insert on tenant_members for insert with check (is_owner(tenant_id));
create policy tenant_members_update on tenant_members for update using (is_owner(tenant_id)) with check (is_owner(tenant_id));
create policy tenant_members_delete on tenant_members for delete using (is_owner(tenant_id));

-- tenant_counters: no policies — application roles never touch it directly.

-- settlement_entries has no tenant_id; it is scoped through its settlement.
create policy settlement_entries_select on settlement_entries for select
  using (exists (select 1 from settlements s where s.id = settlement_id and s.tenant_id in (select user_tenant_ids())));
create policy settlement_entries_insert on settlement_entries for insert
  with check (exists (select 1 from settlements s where s.id = settlement_id and can_write(s.tenant_id)));
create policy settlement_entries_delete on settlement_entries for delete
  using (exists (select 1 from settlements s where s.id = settlement_id and can_write(s.tenant_id)));

-- All other tenant-scoped tables: members read, owner/staff write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sellers', 'agreements', 'submissions', 'items', 'item_events', 'sales',
    'sale_lines', 'sale_returns', 'seller_ledger', 'settlements', 'payouts',
    'pending_operations', 'documents'
  ] loop
    execute format('create policy %I_select on %I for select using (tenant_id in (select user_tenant_ids()))', t, t);
    execute format('create policy %I_insert on %I for insert with check (can_write(tenant_id))', t, t);
    execute format('create policy %I_update on %I for update using (can_write(tenant_id)) with check (can_write(tenant_id))', t, t);
    execute format('create policy %I_delete on %I for delete using (can_write(tenant_id))', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants ALL on new public tables to anon/authenticated by
-- default privilege — revoke first, then grant exactly what is allowed.
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

grant usage on schema public to authenticated;

-- Reads
grant select on
  tenants, tenant_members, sellers, agreements, submissions, items, item_events,
  sales, sale_lines, sale_returns, seller_ledger, settlements, settlement_entries,
  payouts, pending_operations, documents,
  seller_balances, daily_closings, daily_payment_methods
to authenticated;

-- Direct writes: only columns without financial consequence. Status, numbers,
-- amounts derived by the system, and ledger links are function-only.
grant insert (slug, name, org_number, currency, commission_vat_pct, standard_vat_pct, created_by) on tenants to authenticated;
grant update (name, org_number, currency, commission_vat_pct, standard_vat_pct) on tenants to authenticated;

grant insert (tenant_id, user_id, role, invited_by) on tenant_members to authenticated;
grant update (role) on tenant_members to authenticated;
grant delete on tenant_members to authenticated;

grant insert (tenant_id, display_name, email, phone, bankid_subject, payout_method, payout_details_enc, is_active) on sellers to authenticated;
grant update (display_name, email, phone, bankid_subject, payout_method, payout_details_enc, is_active) on sellers to authenticated;

grant insert (tenant_id, seller_id, commission_pct, commission_incl_vat, sale_period_days, markdown_schedule, end_of_period_action, valid_from, valid_to, signed_document_id) on agreements to authenticated;
grant update (valid_to, signed_document_id) on agreements to authenticated;

grant insert (tenant_id, seller_id, received_at, received_by, notes) on submissions to authenticated;
grant update (notes) on submissions to authenticated;

grant insert (tenant_id, ownership, sales_model, seller_id, submission_id, agreement_id, title, description, category, condition,
              initial_price, current_price, commission_pct, commission_incl_vat, vmb_purchase_price, vmb_eligible, for_sale_from, expires_at)
  on items to authenticated;
grant update (title, description, category, condition, current_price, for_sale_from, expires_at) on items to authenticated;
-- status, sold_at, item_no, ownership, seller_id: function-only.

grant insert (tenant_id, channel, external_ref, sold_at, payment_method) on sales to authenticated;
grant update (payment_method, external_ref) on sales to authenticated;
-- sale_lines, sale_returns, seller_ledger: no direct writes at all.

grant insert (tenant_id, seller_id, amount, method, external_ref) on payouts to authenticated;
grant update (external_ref) on payouts to authenticated;

grant insert (tenant_id, seller_id, period_from, period_to) on settlements to authenticated;
grant update (period_from, period_to, document_id) on settlements to authenticated;
grant delete on settlements to authenticated;                 -- drafts only (trigger)

grant insert (settlement_id, ledger_entry_id) on settlement_entries to authenticated;  -- sign defaults to 1
grant delete on settlement_entries to authenticated;          -- drafts only (trigger)

grant insert, update on pending_operations to authenticated;

grant insert (tenant_id, kind, storage_path, sha256, seller_id, related_type, related_id) on documents to authenticated;
grant delete on documents to authenticated;                   -- guarded by trigger

grant usage, select on all sequences in schema public to authenticated;

-- Functions: the public API and the read helpers. Internal helpers
-- (next_counter, set_internal) stay unreachable for application roles.
grant execute on function
  jwt_claims(), current_user_id(), is_privileged(), user_tenant_ids(), tenant_role(uuid),
  can_write(uuid), is_owner(uuid), current_actor(),
  transition_item(uuid, item_status, text),
  record_sale_line(uuid, uuid, numeric),
  return_sale_line(uuid, numeric, text),
  post_ledger_adjustment(uuid, numeric, text),
  transition_payout(uuid, payout_status, text),
  issue_settlement(uuid),
  credit_settlement(uuid)
to authenticated;

-- Trigger functions must be executable by the roles whose statements fire them.
grant execute on function
  tenants_after_insert(), tenant_members_guard(),
  items_before_insert(), items_before_update(), items_audit(), forbid_delete(), forbid_change(),
  sale_lines_before_insert(), sale_lines_after_insert(), sale_lines_before_update(),
  sale_returns_before_insert(), seller_ledger_before_insert(),
  payouts_before_insert(), payouts_before_update(),
  settlements_before_insert(), settlements_before_update(), settlements_before_delete(),
  settlement_entries_before_insert(), settlement_entries_before_delete(),
  documents_before_delete(), sellers_before_insert(), submissions_before_insert(),
  internal_flag(text), item_transition_allowed(item_status, item_status),
  payout_transition_allowed(payout_status, payout_status), assert_can_write(uuid)
to authenticated;
