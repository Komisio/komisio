-- Komisio — phase 0: core schema
--
-- Principles (see README.md and docs/DECISIONS.md):
--   * The core is a consignment engine: consignors (sellers), items, sales,
--     customer returns, the consignor ledger, settlement statements and
--     payouts. There is no general ledger — bookkeeping data is exported to an
--     accounting system by an extension.
--   * Every tenant-scoped table carries tenant_id. Relations between
--     tenant-scoped tables use composite foreign keys (tenant_id, id) so that
--     rows can never reference another tenant's data, regardless of RLS.
--   * Money is numeric(12,2), rounded to öre in the database. Never float.
--   * Business rules are documented in docs/DECISIONS.md, enforced in
--     20260910000002_enforcement.sql and proven by supabase/tests.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type item_status as enum (
  'received',            -- taken in, not yet priced
  'priced',              -- priced, not yet on the floor
  'for_sale',            -- available for sale
  'sold',                -- sold; leaves this state only through a customer return
  'expired',             -- sale period ended, awaiting decision
  'returned_to_seller',  -- handed back to the consignor
  'donated',             -- donated per agreement at end of period
  'withdrawn'            -- voided (mis-registration, theft, damage)
);

create type item_ownership as enum (
  'consignment',   -- the consignor's property until sold
  'store_owned'    -- the store's property (purchased second-hand goods)
);

-- How the item is sold. Ownership says who owns it; sales_model says which
-- commercial arrangement applies. Kept separate on purpose (DECISIONS.md #8).
create type sales_model as enum (
  'commission',        -- store sells on the consignor's behalf, charges commission
  'purchase_resale'    -- store bought the item and resells it
);

-- VAT treatment applied to a sale line. Derived at sale time from the item's
-- sales model and eligibility flags, then frozen together with its basis.
create type vat_treatment as enum (
  'commission_vat',   -- VAT on the commission fee only (brokerage service)
  'margin_scheme',    -- VAT on the margin (vinstmarginalbeskattning, ML 9a kap.)
  'standard_vat',     -- VAT on the full price
  'exempt'            -- no VAT
);

create type actor_type as enum ('user', 'agent', 'system');

create type sale_channel as enum ('pos', 'web', 'marketplace', 'manual');

create type ledger_entry_type as enum (
  'sale_credit',   -- consignor's share of a sale (+)
  'payout',        -- payout to the consignor (−)
  'fee',           -- fee per agreement, e.g. intake fee (−)
  'adjustment',    -- manual correction (+/−), note required
  'reversal'       -- exact negation of an earlier entry (+/−)
);

create type settlement_status as enum ('draft', 'issued', 'credited');

create type payout_status as enum (
  'pending',    -- created, not approved
  'approved',   -- approved → ledger debit posted (funds reserved)
  'sent',       -- handed to the payment rail (Swish/bank)
  'confirmed',  -- confirmed paid
  'failed',     -- failed → reversal posted
  'cancelled'   -- cancelled → reversal posted if it had been approved
);

create type pending_op_status as enum ('staged', 'approved', 'rejected', 'executed', 'failed');
create type risk_level as enum ('low', 'medium', 'high');

-- ---------------------------------------------------------------------------
-- Tenants and membership
-- ---------------------------------------------------------------------------

create table tenants (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name                text not null,
  org_number          text,
  currency            char(3) not null default 'SEK',
  -- Commission is a VAT-liable brokerage service. Stored per tenant so that
  -- stores outside Sweden can set their own rate.
  commission_vat_pct  numeric(5,2) not null default 25.00 check (commission_vat_pct >= 0),
  standard_vat_pct    numeric(5,2) not null default 25.00 check (standard_vat_pct >= 0),
  created_by          uuid,                            -- auth.users(id); becomes the first owner
  created_at          timestamptz not null default now()
);

-- Membership is the only source of tenant access (see DECISIONS.md).
create table tenant_members (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null,                     -- auth.users(id)
  role        text not null check (role in ('owner', 'staff', 'readonly')),
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Per-tenant sequential counters (seller_no, item_no, submission_no,
-- settlement_no). Incremented under row lock; gap-free within a transaction.
-- Not accessible to application roles — only through next_counter().
create table tenant_counters (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  value      bigint not null default 0,
  primary key (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- Consignors and agreements
-- ---------------------------------------------------------------------------

create table sellers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  seller_no          bigint not null,               -- human-facing number, per tenant
  display_name       text not null,
  email              text,
  phone              text,
  bankid_subject     text,                          -- Criipto/BankID "sub"; identity, never a personal number in clear text
  payout_method      text not null default 'none' check (payout_method in ('none', 'swish', 'bank')),
  -- Payout details are encrypted by the application layer (pgsodium/KMS in
  -- phase 3). The column exists so the schema is right from the start.
  payout_details_enc text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),                           -- target for composite FKs
  unique (tenant_id, seller_no),
  unique (tenant_id, bankid_subject)
);

-- Agreement terms. An item freezes its terms at intake (snapshot on items), so
-- an amended agreement never applies retroactively to items already taken in.
create table agreements (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  seller_id             uuid not null,
  commission_pct        numeric(5,2) not null check (commission_pct between 0 and 100),
  -- Whether commission_pct is stated inclusive of VAT towards the consignor.
  -- Private consignors: inclusive (default). Business consignors: usually exclusive.
  commission_incl_vat   boolean not null default true,
  sale_period_days      int not null check (sale_period_days > 0),
  -- e.g. [{"after_days":14,"pct_off":25},{"after_days":28,"pct_off":50}]
  markdown_schedule     jsonb not null default '[]'::jsonb,
  end_of_period_action  text not null check (end_of_period_action in ('return', 'donate', 'keep_for_sale')),
  valid_from            date not null default current_date,
  valid_to              date,
  signed_document_id    uuid,                        -- FK added below (documents)
  created_at            timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_id) references sellers(tenant_id, id) on delete restrict,
  check (valid_to is null or valid_to >= valid_from)
);

-- ---------------------------------------------------------------------------
-- Intake and items
-- ---------------------------------------------------------------------------

create table submissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  seller_id      uuid not null,
  submission_no  bigint not null,
  received_at    timestamptz not null default now(),
  received_by    uuid,                                -- auth.users(id)
  notes          text,
  unique (tenant_id, id),
  unique (tenant_id, submission_no),
  foreign key (tenant_id, seller_id) references sellers(tenant_id, id) on delete restrict
);

create table items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  item_no             bigint not null,               -- barcode/label number, per tenant
  ownership           item_ownership not null default 'consignment',
  sales_model         sales_model not null default 'commission',
  seller_id           uuid,
  submission_id       uuid,
  agreement_id        uuid,
  title               text not null,
  description         text,
  category            text,
  condition           text,
  status              item_status not null default 'received',
  initial_price       numeric(12,2) check (initial_price is null or initial_price >= 0),
  current_price       numeric(12,2) check (current_price is null or current_price >= 0),
  -- Snapshot of the agreement's commission terms at intake. Used by the sale.
  commission_pct      numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  commission_incl_vat boolean,
  -- Margin-scheme basis for store-owned items: purchase price per item, and an
  -- explicit attestation that the margin-scheme conditions are met (bought
  -- from a private person / non-VAT seller etc.). Ownership alone is not enough.
  vmb_purchase_price  numeric(12,2) check (vmb_purchase_price is null or vmb_purchase_price >= 0),
  vmb_eligible        boolean not null default false,
  for_sale_from       date,
  expires_at          date,
  sold_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, item_no),
  foreign key (tenant_id, seller_id)     references sellers(tenant_id, id)     on delete restrict,
  foreign key (tenant_id, submission_id) references submissions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, agreement_id)  references agreements(tenant_id, id)  on delete restrict,
  -- Ownership and sales model must agree, and each model needs its basis.
  check (
    (sales_model = 'commission'      and ownership = 'consignment' and seller_id is not null and commission_pct is not null and commission_incl_vat is not null)
    or
    (sales_model = 'purchase_resale' and ownership = 'store_owned' and vmb_purchase_price is not null)
  )
);

create index items_tenant_status_idx on items (tenant_id, status);
create index items_seller_idx on items (tenant_id, seller_id);

-- Append-only audit log. Every status and price change on an item lands here,
-- written by the trigger in 0002 — never by the application directly.
create table item_events (
  id           bigserial primary key,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  item_id      uuid not null,
  event_type   text not null,                      -- 'created' | 'status_change' | 'price_change'
  from_status  item_status,
  to_status    item_status,
  from_price   numeric(12,2),
  to_price     numeric(12,2),
  actor_type   actor_type not null,
  actor_id     text,                                -- auth uid, agent/API-key id, or job name
  reason       text,
  payload      jsonb,
  occurred_at  timestamptz not null default now(),
  foreign key (tenant_id, item_id) references items(tenant_id, id) on delete cascade
);

create index item_events_item_idx on item_events (item_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Sales and customer returns
-- ---------------------------------------------------------------------------

create table sales (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  channel         sale_channel not null,
  external_ref    text,                             -- Zettle/Shopify/Tradera id
  sold_at         timestamptz not null default now(),
  payment_method  text,
  total_amount    numeric(12,2) not null default 0 check (total_amount >= 0),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  -- Idempotency for importing extensions: same channel + reference = same sale.
  unique (tenant_id, channel, external_ref)
);

-- One row per item per sale occasion. An item can appear in several sale
-- lines over its life (sold, returned, sold again) but in at most one that is
-- not returned (partial unique index below).
create table sale_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  sale_id             uuid not null,
  item_id             uuid not null,
  price               numeric(12,2) not null check (price >= 0),
  -- Everything below is computed by record_sale_line() and frozen.
  vat_treatment       vat_treatment not null,
  vat_rule_version    text not null,                -- which rule set produced the numbers
  vat_basis           jsonb not null,               -- inputs used (price, pct, rates, purchase price)
  vat_amount          numeric(12,2) not null,       -- VAT the store owes on this line
  commission_pct      numeric(5,2),
  commission_amount   numeric(12,2),                -- incl. VAT when commission_incl_vat
  commission_vat      numeric(12,2),
  seller_share        numeric(12,2),
  vmb_margin          numeric(12,2),
  returned_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references sales(tenant_id, id) on delete restrict,
  foreign key (tenant_id, item_id) references items(tenant_id, id) on delete restrict
);

create unique index sale_lines_one_active_per_item on sale_lines (item_id) where returned_at is null;

create table sale_returns (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  sale_line_id       uuid not null,
  refund_amount      numeric(12,2) not null check (refund_amount >= 0),
  reason             text,
  ledger_reversal_id bigint,                        -- FK added after seller_ledger
  actor_type         actor_type not null,
  actor_id           text,
  returned_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (sale_line_id),
  foreign key (tenant_id, sale_line_id) references sale_lines(tenant_id, id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Consignor ledger (append-only) — the most important table in the system
-- ---------------------------------------------------------------------------

create table seller_ledger (
  id                  bigserial primary key,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  seller_id           uuid not null,
  entry_type          ledger_entry_type not null,
  amount              numeric(12,2) not null check (amount <> 0),  -- + credit, − debit
  ref_type            text,                          -- 'sale_line' | 'payout' | 'sale_return' | 'agreement' | ...
  ref_id              uuid,
  reverses_entry_id   bigint references seller_ledger(id),
  note                text,
  actor_type          actor_type not null,
  actor_id            text,
  occurred_at         timestamptz not null default now(),
  foreign key (tenant_id, seller_id) references sellers(tenant_id, id) on delete restrict,
  check (entry_type <> 'adjustment' or note is not null),
  check (entry_type <> 'reversal' or reverses_entry_id is not null)
);

create index seller_ledger_seller_idx on seller_ledger (seller_id, occurred_at);
create unique index seller_ledger_one_reversal on seller_ledger (reverses_entry_id) where reverses_entry_id is not null;

alter table sale_returns
  add constraint sale_returns_ledger_reversal_fk
  foreign key (ledger_reversal_id) references seller_ledger(id);

-- security_invoker: the view runs with the caller's privileges and RLS, never
-- the view owner's.
create view seller_balances with (security_invoker = true) as
  select tenant_id, seller_id, coalesce(sum(amount), 0)::numeric(12,2) as balance
  from seller_ledger
  group by tenant_id, seller_id;

-- ---------------------------------------------------------------------------
-- Settlement statements (the consignment equivalent of a voucher)
-- ---------------------------------------------------------------------------

create table settlements (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  seller_id                 uuid not null,
  settlement_no             bigint,                  -- assigned atomically by issue_settlement()
  status                    settlement_status not null default 'draft',
  period_from               date,
  period_to                 date,
  total_credits             numeric(12,2),           -- frozen at issue
  total_debits              numeric(12,2),
  net_amount                numeric(12,2),
  issued_at                 timestamptz,
  credits_settlement_id     uuid references settlements(id),  -- set on the credit note
  credited_by_settlement_id uuid references settlements(id),  -- set on the original
  document_id               uuid,
  created_at                timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, settlement_no),
  foreign key (tenant_id, seller_id) references sellers(tenant_id, id) on delete restrict,
  check (status = 'draft' or (settlement_no is not null and issued_at is not null))
);

-- Which ledger entries a settlement covers. The ledger itself is never
-- touched (append-only), so the link lives here. sign = -1 on credit notes.
create table settlement_entries (
  settlement_id    uuid not null references settlements(id) on delete cascade,
  ledger_entry_id  bigint not null references seller_ledger(id),
  sign             smallint not null default 1 check (sign in (1, -1)),
  primary key (settlement_id, ledger_entry_id)
);

-- ---------------------------------------------------------------------------
-- Payouts
-- ---------------------------------------------------------------------------

create table payouts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  seller_id          uuid not null,
  amount             numeric(12,2) not null check (amount > 0),
  method             text not null check (method in ('swish', 'bank', 'cash', 'manual')),
  status             payout_status not null default 'pending',
  external_ref       text,
  ledger_entry_id    bigint references seller_ledger(id),   -- the debit, set at approved
  reversal_entry_id  bigint references seller_ledger(id),   -- the reversal, set at failed/cancelled
  approved_by        text,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (tenant_id, seller_id) references sellers(tenant_id, id) on delete restrict
);

create index payouts_seller_status_idx on payouts (seller_id, status);

-- ---------------------------------------------------------------------------
-- Staged operations — every write from an agent or extension goes through here
-- (see DECISIONS.md)
-- ---------------------------------------------------------------------------

create table pending_operations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  operation_type  text not null,                     -- 'create_items' | 'update_item_price' | 'approve_payout' | ...
  params          jsonb not null,
  preview         jsonb,
  risk            risk_level not null default 'medium',
  status          pending_op_status not null default 'staged',
  actor_type      actor_type not null,
  actor_id        text,
  created_at      timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  executed_at     timestamptz,
  result          jsonb,
  error           text
);

create index pending_ops_tenant_status_idx on pending_operations (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Documents (consignment agreements, settlement statements, receipts)
-- ---------------------------------------------------------------------------

create table documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  kind          text not null check (kind in ('agreement', 'settlement', 'receipt', 'other')),
  storage_path  text not null,                       -- Supabase Storage object
  sha256        text,
  seller_id     uuid,
  related_type  text,
  related_id    uuid,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_id) references sellers(tenant_id, id) on delete restrict
);

alter table agreements
  add constraint agreements_signed_document_fk
  foreign key (tenant_id, signed_document_id) references documents(tenant_id, id);

alter table settlements
  add constraint settlements_document_fk
  foreign key (tenant_id, document_id) references documents(tenant_id, id);

-- ---------------------------------------------------------------------------
-- Daily closing as VIEWS — never a table that can drift from the sales.
-- This is what a ledger-export extension (Accounted/Fortnox) reads.
-- ---------------------------------------------------------------------------

create view daily_closings with (security_invoker = true) as
  select
    s.tenant_id,
    (s.sold_at at time zone 'Europe/Stockholm')::date                          as closing_date,
    count(distinct s.id)                                                          as sale_count,
    sum(sl.price)                                                                 as gross_sales,
    sum(sl.price)             filter (where sl.returned_at is not null)           as returned_sales,
    sum(sl.vat_amount)                                                            as vat_amount,
    sum(sl.commission_amount) filter (where sl.vat_treatment = 'commission_vat') as commission_incl_vat,
    sum(sl.commission_vat)    filter (where sl.vat_treatment = 'commission_vat') as commission_vat,
    sum(sl.seller_share)      filter (where sl.vat_treatment = 'commission_vat') as seller_share_total,
    sum(sl.price)             filter (where sl.vat_treatment = 'margin_scheme')  as margin_scheme_sales,
    sum(sl.vmb_margin)        filter (where sl.vat_treatment = 'margin_scheme')  as margin_total,
    sum(sl.price)             filter (where sl.vat_treatment = 'standard_vat')   as standard_vat_sales
  from sales s
  join sale_lines sl on sl.sale_id = s.id
  group by s.tenant_id, closing_date;

create view daily_payment_methods with (security_invoker = true) as
  select
    s.tenant_id,
    (s.sold_at at time zone 'Europe/Stockholm')::date as closing_date,
    coalesce(s.payment_method, 'unknown')              as payment_method,
    sum(sl.price)                                       as amount
  from sales s
  join sale_lines sl on sl.sale_id = s.id
  group by s.tenant_id, closing_date, payment_method;
