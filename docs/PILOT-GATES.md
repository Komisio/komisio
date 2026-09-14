# Pilot gates: isolation, seller data export, backup and restore

The roadmap names four gates before an external pilot: tenant isolation,
backup and restore, privacy and retention, and export and support
procedures. This document records what is in place for each, what is proven
by a test, and what remains an owner or operator action.

## Tenant isolation

`supabase/tests/0056_tenant_isolation.test.sql` is a structural sweep that
grows with the schema instead of naming tables:

- every table in `public` has row level security; the only table without a
  policy is the engine-only statement counter;
- anonymous callers can execute exactly three functions: the public store
  profile read and the two storage access hooks; every other function is
  revoked from `anon` and `PUBLIC` (migration `20260915130000` closed the two
  that the default grant had left open; both already required a member);
- neither `anon` nor `PUBLIC` holds any table privilege; `authenticated` holds
  `select` only, never a write;
- every view runs as the invoker;
- with one tenant seeded through the ordinary engine commands into at least
  28 tenant-scoped tables, another tenant's owner sees zero rows of it in
  every table that carries `tenant_id`, and the member reads (balance,
  profile, economy, settlement candidates, operations queue) refuse; an
  anonymous session sees zero rows in every table.

A new table is covered the moment it exists: if it lacks RLS, a policy or
an invoker view option, or if a function is left executable by anon, the
sweep fails in CI.

## Seller data export

`seller_data_export(tenant, seller)` returns every row Komisio holds about
one seller in one JSON document: the seller record, terms versions,
agreement evidence, notification preferences, bags and their inspection
drafts, receptions with their source revisions, reviews and garments, items
with events and prices, sale lines with their sale headers, returns, ledger
entries, payouts with events, statements with lines, and communications.
Tenant ids are stripped; nothing about other sellers is reachable. Owner or
admin only; every call is an access event `seller.exported`. The seller page
offers it as a download (`/api/sellers/<id>/export`) to owners and admins.

Procedure for a data request: verify the requester is the seller (the store
knows its sellers; the e-mail on file is the verified channel), download the
export from the seller page, and hand it over through the channel the seller
uses with the store. Retention and erasure are not automated: financial rows
(sales, ledger, payouts, statements) are kept for bookkeeping; the owner
decides on erasure of contact data per case until a retention policy is
written. `supabase/tests/0057_seller_data_export.test.sql` proves the
scope, the log entry and the refusals.

## Backup and restore

Hosted: the Supabase project keeps daily backups on the current plan;
point-in-time recovery is a plan option the owner selects before the pilot.
Restoring is a project-level action in the Supabase dashboard; storage
objects (reception photos) are backed up separately (see HOSTED-STAGING.md).

Local and self-hosted: `npm run backup:exercise` dumps the running database
with `pg_dump` inside the container, restores it into a fresh disposable
database, compares the row count of every public table, prints the counts,
and drops the copy. It never touches the source database. Run it before
the pilot and after every migration batch; a mismatch or a failed restore is
a stop.

Restore exercise record: run on 2026-09-13 against the local stack with
migrations through `20260915130000`; every table matched.

## Still open

The consolidated list of owner actions and pending product decisions with
proposed defaults is [OWNER-ACTIONS-2026-09-14.md](OWNER-ACTIONS-2026-09-14.md).

- Retention policy and erasure procedure for seller contact data.
- Storage object backup on the hosted project.
- Point-in-time recovery selection on the hosted plan.
- pg_cron enabled on the hosted project, then
  `select cron.schedule('komisio-automatic-markdowns','15 3 * * *','select komisio_private.run_automatic_markdowns()')`
  (the markdown agent's daily run; the migration schedules it only where the
  extension already exists).
- A complete authenticated hosted journey exercised by the owner.
- Fortnox pilot: `FORTNOX_PILOT_TENANT_ID`, `FORTNOX_EXPECTED_COMPANY_NAME` and
  `KOMISIO_CREDENTIAL_KEY` set, the callback URL registered in the Fortnox
  developer portal, one connection made and checked against the test company,
  then `FORTNOX_EXPECTED_DATABASE_NUMBER` pinned (see FORTNOX-CONNECTION.md).
  Done 2026-09-14 except the optional database pin (owner decision: not needed).
- Deploy ordering: turn off Vercel's automatic deployment for main and let the
  workflow fire a Vercel deploy hook after the `staging-migrations` job, so
  the database always migrates before the application deploys (see
  REVIEW-2026-09-14.md, finding 1). Until then new page reads tolerate a
  missing RPC for the minutes in between.
- The `staging-database` GitHub environment restricts deployment branches to
  main and holds the staging account's management token only.
- Billing (hosted only): once the plan slice is on staging, the owner runs
  `select komisio_private.enable_billing('<owner auth user id>')` as the
  database owner, which turns billing on, makes the owner a platform host and
  keeps existing stores active; then, where pg_cron exists,
  `select cron.schedule('komisio-expire-plans','45 3 * * *','select komisio_private.expire_plans()')`
  if the migration did not schedule it. New stores start a 30-day trial from
  then on.
- Stripe (sandbox for staging): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (the
  199 SEK monthly price, excluding VAT) and `STRIPE_WEBHOOK_SECRET` for the
  endpoint `<NEXT_PUBLIC_APP_URL>/api/billing/webhook` with the events
  checkout.session.completed, customer.subscription.updated,
  customer.subscription.deleted, invoice.paid, invoice.payment_failed; the
  automation identity registered as billing actor with
  `select komisio_private.register_billing_actor('<automation user id>')`.
