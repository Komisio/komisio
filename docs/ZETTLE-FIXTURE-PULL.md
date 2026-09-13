# Zettle purchase import (Astra task 4)

This slice tests the import and financial boundary with synthetic purchase
payloads. It does not connect to a merchant, register an OAuth app, fetch live
purchases, process Zettle payments, or send seller e-mails.

## Workflow

1. In a local test store, open Intake → Zettle integration and sync test receipts.
2. The engine stores a minimized immutable receipt and a cursor checkpoint in
   one transaction. Importing or resolving a line creates no sale or seller credit.
3. A complete exact `I-XXXXXXXX` label in the documented SKU, barcode or comment
   matches only a unique item in that store. Conflicting labels, missing items and
   short UUID collisions remain in `unmatched_sale_lines`. Initial unmatched facts
   are retained; append-only resolutions determine the current result.
4. Open the receipt. Resolve missing/incorrect matches with a full item UUID from
   the item page URL. Each change checks the mapping revision; a foreign item is
   refused even when the operator belongs to both stores.
5. Propose the whole purchase. `recordZettlePurchase` is medium risk and requires
   a different authenticated staff member to approve through the existing queue.
   The review shows the immutable receipt and the mapping as of the proposed
   revision. Subsequent changes make the old proposal stale. SQL rechecks at approval.
6. Approval calls the existing `record_sale`, provider `zettle`, external ID
   `purchaseUUID1`. Existing SQL computes tax, commission, item events and seller
   credit atomically. Replaying a purchase cannot add sale lines or credits again.

The latest successful sync and a paginated receipt list are available at
`/intake/integrations`; each receipt has a stable detail URL. Failed HTTP requests
show an error without advancing the cursor. A lost response retains its request
ID, and a retry reads the committed page instead of refetching a moving page.
There is no background sync or durable failure history in this slice.

## Deliberate scope decisions

Fable's dispatcher stack is merged. The new medium-risk kind follows that stack;
no auto-execution scope was added. Identity, role and MFA remain database-enforced.
Integration tables contain evidence and matching history, not a second financial
ledger. There is no service-role client in the extension or application.

Task 4's phrase "record_sale for that line" conflicts with the immutable complete
payload of an existing external receipt. This implementation holds the _whole_
purchase until every row is resolved, then calls the existing engine once. It
never manufactures per-line external IDs or appends to a previously recorded sale.

Only positive SEK POS receipts, supported product types, unit quantities, unique
items and matching gross totals are accepted. Discounts, refunds/already refunded
receipts, service charges and other unsupported cases are held. Inspect their
original receipts in Zettle; this adapter does not guess their financial treatment
or allow staff to change the imported prices. Unknown payment/card/employee/GPS
fields are discarded. The fixture data is original synthetic data shaped after
the documented API, **not merchant recordings**. See [the transport contract](../extensions/zettle/README.md).

## Local verification

Start the existing local Supabase, apply additive migrations and run
`node scripts/configure-local.mjs`. Set `KOMISIO_INTAKE_ENABLED=true` and
`KOMISIO_ZETTLE_FIXTURES=true` for the local dev process. Both app and Supabase URLs
must use `localhost` or `127.0.0.1`; the test transport cannot be enabled against
hosted data by setting the flag alone. Never configure this flag in staging.
The Playwright-managed local server sets the fixture flag explicitly.

- `tests/unit/zettle.test.ts`: documented mapping, unsupported/malformed payloads,
  minimization, cursor and transport behavior, hosted configuration refusal.
- `supabase/tests/0051_zettle.test.sql`: import replay, exact receipts, cursor
  conflicts, no partial sale, matching revision, label collisions, cross-store
  items, RLS/roles/MFA, immutable facts, second-person approval and seller credit.
- `tests/e2e/zettle.spec.ts`: local fixture sync with a dropped successful response,
  manual matches, actual browser approval, mobile layout, parallel HTTP proposal
  replay and conflicting decisions; one sale/two lines/one credit per seller line.

Migrations `20260915004000`, `20260915005000` and `20260915006000` have been applied
locally and must not be edited. Release CI/staging evidence is recorded in the PR.

## Live work remaining

The owner must provide a Zettle developer app and test merchant. Implement OAuth,
secret storage/refresh/revocation and verified merchant-to-tenant binding, then
plug the authenticated transport into the same engine path. Bound request sizes,
timeouts and pagination; add rate-limit/backoff handling and observable failures.
`lastPurchaseHash` is a pagination cursor, **not a verified durable incremental
watermark**. Define a stable retrieval window, overlap and reconciliation/recovery
before scheduled sync. Validate real test-merchant payloads and label placement.
Unsupported discounts, refunds and receipt changes require separate explicit
financial contracts and fixtures before they can be enabled. No live readiness
claim is made by a successful synthetic journey.

## Staging and rollback

Apply only the reviewed additive migrations to the known staging project after
required CI passes; publish the app through the protected merge. Existing roles
and financial engine signatures remain unchanged. Staging exposes the offline
status; no test purchase is injected there. Smoke-check authentication, foreign
origin rejection and the new routes. If the new surface fails, revert the app
change through a PR; retain immutable imported evidence and applied migrations.
Never delete sales or matching history as a rollback. Do not enable live sync
until the live prerequisites above are tested.
