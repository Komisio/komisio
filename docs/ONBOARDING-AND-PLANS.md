# Optional hosted billing

Self-hosting does not require a paid plan. Operators can configure billing and
AI credits separately. See [PRICING.md](PRICING.md) for current credit behavior
and [STRIPE-TAX.md](STRIPE-TAX.md) for tax configuration.

## Stripe configuration

- A store owner presses "Activate the subscription" on the settings page: the
  server creates a hosted Checkout session (subscription mode, the price
  from `STRIPE_PRICE_ID`, tax id collection, the tenant id as reference and
  subscription metadata) and redirects; "Manage subscription and invoices"
  opens Stripe's customer portal for the stored customer. Owner only; both
  need `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`, otherwise the panel says
  online payment is not configured. Checkout now follows the app locale. With
  `KOMISIO_STRIPE_AUTOMATIC_TAX=true`, it checks an exclusive Price, requests
  automatic tax, and reuses the owner-readable customer with address/name updates.
  An existing shipping address blocks the session pending operator correction.
  Credit packs create a customer and invoice when the flag is on. The flag is
  off by default; operator configuration and staging tests are required.
- `POST /api/billing/webhook`: the signature (`Stripe-Signature`, five-minute
  tolerance) is checked against the raw body; the event is mapped
  (`mapStripeEvent`) to one of active, past_due, read_only,
  cancel_at_period_end or none and recorded by the billing actor through
  `record_billing_event`, once per event id (`billing_events`). The tenant
  comes from the event or is found by subscription or customer id. Completed
  Checkout and paid invoice events also retain bounded Stripe tax facts, without
  VAT ID values or addresses; see [STRIPE-TAX.md](STRIPE-TAX.md). Grace on
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

## Plan notices

- `due_plan_notices()` (billing actor) lists stores that need a notice:
  `trial_week` (seven days left), `trial_tomorrow`, `trial_ended` (the store
  continued on the free core after a trial, within three days; read-only
  before 2026-09-16) and `grace_week` (payment overdue,
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

## Weekly brief

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
