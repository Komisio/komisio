# Operational verification

An installation must verify tenant isolation, export, recovery and backups
before handling real store data. These checks complement the automated suite.

## Tenant isolation

`supabase/tests/0056_tenant_isolation.test.sql` is a structural sweep that
grows with the schema instead of naming tables:

- every table in `public` has row level security; the only table without a
  policy is the engine-only statement counter;
- anonymously executable functions must match the explicit tested allowlist;
  authorization inside each allowed function still applies;
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

MFA recovery is documented in
[OPERATIONS-MFA-RECOVERY.md](OPERATIONS-MFA-RECOVERY.md): independent identity
verification by the store owner, a scoped dashboard action by an operator,
restricted support evidence, and re-enrolment followed by a fresh MFA login.
No self-service reset or new application privilege is introduced. The synthetic
staging recovery exercise remains an operator action before external users.

## Backup and restore

Hosted operators must configure backups and choose appropriate recovery
objectives; available backup and point-in-time options depend on the provider.
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

See [OPERATIONS-RUNBOOK.md](OPERATIONS-RUNBOOK.md) for worker recovery and
[STRIPE-TAX.md](STRIPE-TAX.md) before enabling automatic tax.
