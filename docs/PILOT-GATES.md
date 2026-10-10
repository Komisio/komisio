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

`seller_data_export(tenant, seller)` returns recorded information about
one seller in one JSON document: the seller record, terms versions,
agreement evidence, notification preferences, announced handovers and their
event history, bags and their inspection
drafts, receptions with their source revisions, reviews, seller responses and garments, items
with events and prices, sale lines with their sale headers, returns, ledger
entries, payouts with events, statements with lines, and communications.
It also includes the seller's photo proposals and corrections, frozen price and
AI suggestion, review decisions, reception-preparation links and the exact
agreement texts for which that seller has acceptance evidence. Photo references
are included; downloading this JSON does not download the image files.
Tenant ids are stripped; nothing about other sellers is reachable. Owner or
admin only; every call is an access event `seller.exported`. The seller page
offers it as a download (`/api/sellers/<id>/export`) to owners and admins.

Review responses include their id, review id, decision, responder and time.
Review access events and token hashes, assistance metering, photo fingerprints
and stored image files are not included. This documents the export contents;
it does not replace review of a specific data request.

Procedure for a data request: verify the requester is the seller (the store
knows its sellers; the e-mail on file is the verified channel), download the
export from the seller page, and hand it over through the channel the seller
uses with the store. Retention and erasure are not automated: financial rows
(sales, ledger, payouts, statements) are kept for bookkeeping; the owner
decides on erasure of contact data per case until a retention policy is
written. `supabase/tests/0057_seller_data_export.test.sql` proves the
scope, the log entry and the refusals.

## Lost MFA device

Owner decision B2 is documented in
[OPERATIONS-MFA-RECOVERY.md](OPERATIONS-MFA-RECOVERY.md): independent identity
verification by the store owner, a scoped dashboard action by an operator,
restricted support evidence, and re-enrolment followed by a fresh MFA login.
No self-service reset or new application privilege is introduced. The synthetic
staging recovery exercise remains an operator action before external users.

## Backup and restore

Hosted: the Supabase project keeps daily backups on the current plan;
point-in-time recovery is a plan option the owner selects before the pilot.
Restoring is a project-level action in the Supabase dashboard; storage
objects (reception photos) are backed up separately (see HOSTED-STAGING.md).

Local and self-hosted: `npm run backup:exercise` dumps the running database
with `pg_dump` inside the container, restores it into a fresh disposable
database as an existing privileged role that recreates the original
ownership (`KOMISIO_RESTORE_DB_USER`, `supabase_admin` in the bundled
Supabase image; a self-hosted stack names its own role), verifies the
application schemas (`public` and `komisio_private`) in the copy, and drops
only that copy. It never writes to the source database and never creates,
alters or grants roles. Run it before the pilot and after every migration
batch.

The verdict `APPLICATION RESTORE CHECK PASSED` means all of the following
held: `pg_restore` exited normally with no error; the same table names in
both directions with the same row counts; the same functions, triggers,
policies, constraints, indexes, row-level security flags, owners and grants
by definition. It compares counts and definitions, not row contents. Any
restore error, any other exit status, a failed process, or a difference in
those objects is a stop. An aggregate function in the application schemas
is reported as unsupported and stops the check, because its definition is
not digested. The exercise does not prove storage objects or
hosted point-in-time recovery, and a source that is written during the dump
can produce a false mismatch; rerun in a quiet moment before treating that
as a failure.

Restore exercise record: run on 2026-09-13 against the local stack with
migrations through `20260915130000`, and again on 2026-09-14 with migrations
through `20260916070000` (plans, billing, automation and notices tables
included); every table matched both times.

## Still open

Day-to-day operation of what is delivered (jobs, secrets, health checks,
failures) is in [OPERATIONS-RUNBOOK.md](OPERATIONS-RUNBOOK.md).

The consolidated list of owner actions and pending product decisions with
proposed defaults is [OWNER-ACTIONS-2026-09-14.md](OWNER-ACTIONS-2026-09-14.md).

The ordered production steps (project, environment, secrets, drills, smoke
journey) are in [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md).

- Retention policy and erasure procedure for seller contact data.
- Storage object backup on the hosted project.
- Point-in-time recovery selection on the hosted plan.
- pg_cron enabled on the hosted project, then
  `select cron.schedule('komisio-automatic-markdowns','15 3 * * *','select komisio_private.run_automatic_markdowns()')`
  (the markdown agent's daily run; the migration schedules it only where the
  extension already exists).
- A complete authenticated hosted journey exercised by the owner.
- A recorded synthetic MFA recovery exercise using OPERATIONS-MFA-RECOVERY.md.
- Fortnox pilot: `FORTNOX_PILOT_TENANT_ID`, `FORTNOX_EXPECTED_COMPANY_NAME` and
  `KOMISIO_CREDENTIAL_KEY` set, the callback URL registered in the Fortnox
  developer portal, one connection made and checked against the test company,
  then `FORTNOX_EXPECTED_DATABASE_NUMBER` pinned (see FORTNOX-CONNECTION.md).
  Done 2026-09-14 except the optional database pin (owner decision: not needed).
- Deploy ordering: turn off Vercel's automatic deployment for main and let the
  workflow fire a Vercel deploy hook after the `staging-migrations` job, so
  the database always migrates before the application deploys. Until then new
  page reads tolerate a missing RPC for the minutes in between.
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
- `CRON_SECRET` in Vercel (at least 16 characters); Vercel Cron then calls the
  automation routes (plan notices daily, Zettle retrieval when delivered).
