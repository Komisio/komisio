# Onboarding, environments and plans

Design note by Fable, 2026-09-14, at the owner's request. It answers three
questions a store owner asks before Komisio can be sold as a hosted service:
where do I start, how does my account become active, and what do I pay. It
proposes; the decisions are listed at the end and in
[OWNER-ACTIONS-2026-09-14.md](OWNER-ACTIONS-2026-09-14.md), section C.
Owner decisions C1 to C6 (2026-09-14): approved, price excluding VAT.
Slice 1 (plan state, gate, trial, host activation) is delivered in
migration `20260916030000`; see "Delivered" at the end.

## The shape of the offer

Hosted Komisio follows the common software-as-a-service pattern: a store
registers itself, gets a full month free, and then pays a monthly fee per
store. There is no sales call, no manual activation and no separate "test
account": the store a person creates on day one is the store they keep.

| Tier        | Who                                    | Price                       | Notes                                                                                                |
| ----------- | -------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Self-hosted | Anyone running the open-source code    | Free (AGPL-3.0-or-later)    | No billing code runs; every store is `active` for ever                                               |
| Hosted      | Stores on the Komisio-operated service | SEK 199 per store and month | 30-day free trial from store creation; the price is the roadmap's direction, VAT treatment to decide |

One price, one plan, per store. Feature tiers, AI plans and quotas stay in
the roadmap (P6) and are not part of the first billing slice.

## Environments: where a store starts

- **Production** (`app.komisio.com`, proposed): the only environment
  customers ever see. Registration, trial and payment all happen here. One
  Supabase project, one Vercel project, `KOMISIO_ENVIRONMENT=production`.
- **Staging** (`komisio-staging.vercel.app`): internal. Every merge to main
  deploys here first; the owner and the agents exercise journeys with test
  data. Customers are never invited to staging. A store that wants to try
  Komisio uses its free month in production with its own test data, then
  keeps or deletes that store.
- **Local**: the developer's own stack.

Promotion is by code, not by data: production runs the same main revision
after it has been observed on staging for a period the owner sets (proposal:
one working day). Migrations reach production through the same CI job as
staging, from a separate GitHub environment (`production-database`) whose
job is manually approved by the owner (GitHub environment protection rule
"required reviewers"). No data is ever copied between environments.

`scripts/check-hosted-env.mjs` accepts `KOMISIO_ENVIRONMENT=production`
only with a production shape (own domain, real e-mail, own secrets, no
staging-only switches); the production migrations run from the
`Production database` workflow the owner dispatches and approves. The
ordered owner steps are in [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md).

## Account lifecycle

1. **Register**: e-mail and password, e-mail confirmation (exists). Optional
   MFA (exists).
2. **Create a store**: name and slug (exists). Creating the store starts the
   trial: `trial` state, `trial_ends_at` = now + 30 days. The person is the
   owner.
3. **Guided onboarding** (new, thin): a checklist on the store's start page
   that reads the store's state and links to the missing step. Order:
   store policy (commission, sale period, markdowns, VAT modes with the
   accountant), seller agreement text, first seller, first bag or garment,
   first sale (POS or manual), first day close, integrations (Zettle,
   Fortnox), colleagues invited. Each row is computed from facts that
   already exist; nothing is stored for the checklist itself. The roadmap's
   conversational onboarding agent (P4) later drives the same checklist.
4. **Trial notices**: e-mails to the owner on day 23 ("one week left"), day
   29 ("tomorrow") and day 30 ("your store is now read-only until you
   subscribe"), through the existing communications dispatch with fixed
   templates. Shown as a banner in the app from day 23.
5. **Subscribe**: "Activate subscription" opens Stripe Checkout (card or
   invoice, SEK, monthly, per store). The webhook records the subscription
   and moves the store to `active`. Stripe hosts the customer portal
   (payment method, invoices, cancel); Komisio stores only the customer id,
   subscription id and state.
6. **Payment fails**: `past_due` with a 14-day grace; banner and e-mail; the
   store keeps working. After grace: `read_only`.
7. **Read-only**: every read works, exports work (SIE, seller data export,
   statements), payouts already approved may be marked paid, nothing new is
   recorded: no reception, no sale import, no markdowns, no agent proposals.
   Reactivating returns the store to `active` at once.
8. **Cancel**: `read_only` from the end of the paid period; after 90 days
   the owner is offered export and deletion; erasure follows the retention
   decision (B1 in the owner list). Nothing is deleted automatically.

States: `trial` → `active` → (`past_due` → `read_only`) → `active`;
`trial` → `read_only` (trial ended) → `active`; any → `closed` (owner
request after export). Self-hosted deployments have no states: the plan
check returns `active` when billing is not configured.

## Where the gate lives

Read-only is a commercial state, not a security boundary: members keep
their roles and RLS is untouched. It is enforced in one place in SQL, so the
interface, the MCP tools and the extensions cannot differ:
`komisio_private.require_writable(tenant)` raises `PLAN_READ_ONLY` and is
called by the write commands with financial or inventory effect (receive
bag, publish review, accept item, record sale, register purchase, record
return, markdowns, payouts request and approve, staged operation execution).
Reads, exports, settings that do not create facts, and marking an approved
payout paid stay allowed. The check reads `tenant_plans` (one row per
tenant: state, trial_ends_at, grace_ends_at, provider ids) and an
append-only `tenant_plan_events` table written only by the billing engine
(`start_trial` at store creation, `record_subscription` from the webhook,
`expire_trials` and `expire_grace` daily through pg_cron like the markdown
agent, `close_store` by the owner).

The platform host (Komisio's own operator role, a new `host` flag on a
user, not a tenant role) gets one page: stores, state, trial end, MRR, and
a manual "mark active until <date>" for invoice customers, recorded as a
plan event with a reason. No other host powers; support acts through the
owner's own account or documented operator procedures.

## Production checklist (before the first paying store)

- Production Supabase project (Stockholm) with PITR and storage backup;
  production Vercel project with its own domain and secrets; separate
  Fortnox and Zettle integrations registered for production; separate
  `KOMISIO_CREDENTIAL_KEY`.
- `production-database` GitHub environment with required reviewer (owner),
  main-only, its own management token; the deploy hook pattern from
  staging.
- Terms of service, privacy notice and data processing agreement published
  (the store is the controller of its sellers' data; Komisio the processor).
- Stripe account in the operating company's name, SEK, invoices with VAT;
  Stripe Tax if selling outside Sweden later.
- Support address and incident procedure; the pilot gate items in
  [PILOT-GATES.md](PILOT-GATES.md) closed.

## Slices, in order

1. **Plan state and gate** (migration, pgTAP): `tenant_plans`,
   `tenant_plan_events`, `require_writable`, trial start at store creation,
   daily expiry runs, host page, manual activation. Self-hosted stays free.
   No provider yet; the owner activates the pilot stores by hand.
2. **Onboarding checklist** on the start page, computed from facts; trial
   banner and the three trial e-mails.
3. **Stripe**: Checkout session, webhook (signature verified, idempotent by
   event id, staged as engine calls), customer portal link, `past_due`
   handling. Prices and tax settings live in Stripe, never in code.
4. **Production environment** per the checklist: the guard, the dispatched
   and approved migration workflow and the ordered owner steps are delivered
   (2026-09-15, [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md)); the
   accounts, secrets and drills are the owner's.

## Decisions needed (section C in the owner list)

C1 price and VAT presentation (SEK 199 incl. or excl. VAT; per store);
C2 trial length (30 days) and grace (14 days); C3 what read-only blocks
(the list above); C4 payment provider and methods (Stripe; card and
invoice); C5 production domain and operating company on the Stripe account;
C6 staging soak time before production (one working day) and who approves
production migrations (the owner).

## Delivered (slice 1, 2026-09-14)

- `platform_settings.billing_enabled` (off by default; self-hosted never
  turns it on), `platform_hosts`, `tenant_plans` (state, provider, trial,
  grace, manual end date, who set the deadline; changes only through the
  engine), append-only `tenant_plan_events`.
- Store creation starts a 30-day trial while billing is on
  (`komisio_private.start_trial`, actor: the creator). The one gate
  `komisio_private.require_writable` is attached as a before-insert trigger
  to the fact tables (sellers, bag and garment receipts, reception sessions,
  purchases, items, item prices, sales, returns, payouts, pending
  operations, markdown runs, handovers): a read-only or closed store raises
  `PLAN_READ_ONLY`; reads, exports and updates such as marking a payout paid
  stay open.
- `komisio_private.expire_plans` daily through pg_cron (03:45 UTC where the
  extension exists): trials, grace periods and dated manual activations
  that passed become read-only, recorded with the person who set the
  deadline as actor.
- Host: `komisio_private.enable_billing(host user)` is the one-time switch
  the operator runs; it also keeps every existing store active on a manual
  plan. `activate_plan_manually(tenant, until, reason)` and
  `host_plan_overview()` for hosts, with `host_activity_overview()` next to
  it (members, sellers, items, sales in the last thirty days and the last
  access event per store: counts only, migration `20260916240000`);
  `close_store(tenant, reason)` for the owner; `plan_status(tenant)` for
  every member.
- Surfaces: a banner on every page when the plan needs attention (trial
  ending within a week, overdue, read-only, closed), the plan panel on the
  settings page, and `/host` for platform hosts with manual activation.
- Not yet: Stripe (slice 3), trial e-mails and the onboarding checklist
  (slice 2), the production environment (slice 4).

## Delivered (slice 2, part one, 2026-09-14)

- The start page checklist now covers the whole first journey when intake
  is enabled: account, store, profile, store policy, seller agreement, first
  seller, first item, first sale, first day close, Zettle or Fortnox, first
  colleague. Every row is computed from existing facts under the person's
  own session (`lib/engine/onboarding.ts`); nothing is stored. Trial e-mails
  wait for the Resend configuration (owner action A5).

## Delivered (slice 3, 2026-09-14): Stripe

- Owner presses "Activate the subscription" on the settings page: the
  server creates a hosted Checkout session (subscription mode, the price
  from `STRIPE_PRICE_ID`, tax id collection, the tenant id as reference and
  subscription metadata) and redirects; "Manage subscription and invoices"
  opens Stripe's customer portal for the stored customer. Owner only; both
  need `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`, otherwise the panel says
  online payment is not configured.
- `POST /api/billing/webhook`: the signature (`Stripe-Signature`, five-minute
  tolerance) is checked against the raw body; the event is mapped
  (`mapStripeEvent`) to one of active, past_due, read_only,
  cancel_at_period_end or none and recorded by the billing actor through
  `record_billing_event`, once per event id (`billing_events`). The tenant
  comes from the event or is found by subscription or customer id. Grace on
  a failed payment is 14 days from the first failure; cancel at period end
  keeps the store active until the date, then the daily run closes it; a
  store closed by its owner records events without changing state.
- The billing actor is the automation identity: the operator runs
  `select komisio_private.register_billing_actor('<automation user id>')`
  (a platform host of kind `billing`; it cannot activate manually, and
  person hosts cannot record billing events).
- Migration `20260916040000`; pgTAP 0074; unit tests for the form encoding,
  signature, event mapping, checkout and the engine call. Without the three
  Stripe settings nothing changes: the webhook answers 404 and the panel
  shows the contact note. A live key (`sk_live_`) counts as not configured
  unless `KOMISIO_ENVIRONMENT=production`, so staging can never charge a
  real card.

## Delivered (slice 2, part two, 2026-09-14): trial notices

- `due_plan_notices()` (billing actor) lists stores that need a notice:
  `trial_week` (seven days left), `trial_tomorrow`, `trial_ended` (read-only
  after a trial, within three days) and `grace_week` (payment overdue,
  grace ending within a week), with the owners' addresses and the first
  owner's language. `record_plan_notice` records one row per store and
  kind (`plan_notices`, immutable; owners and hosts read).
- `GET /api/automation/plan-notices` runs daily from Vercel Cron (06:15 UTC)
  with `Authorization: Bearer <CRON_SECRET>`, signs in as the billing actor,
  renders the fixed template in the owner's language (`planNotices`) and
  sends through the same allowlisted transport as seller e-mails
  (`SELLER_EMAIL_*`, falling back to the invitation settings). A store with
  no owner address is recorded as `none` and not retried.
- Migration `20260916070000`; pgTAP 0076; unit tests for rendering and the
  send-and-record loop.

## Delivered (2026-09-14, evening): weekly brief by e-mail

- An owner switches "Send the weekly brief" on the economy page; that is an
  automation grant with scope `weekly_brief` (AUTOMATION-ACTOR.md). Every
  Monday 05:30 UTC the automation identity accepts open grants, reads last
  week's brief for each such store (`economy_summary` and `economy_brief`
  open to that scope and nothing else) and mails the fixed sentences to the
  owners through the allowlisted transport, once per store and week
  (`brief_sends`, immutable; owners and admins read). Migration
  `20260916200000`; pgTAP 0090; unit tests for the week arithmetic and the
  send loop. A generic owner route `POST /api/automation-grants` serves any
  scope switch.
