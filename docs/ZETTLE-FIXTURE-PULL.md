# Zettle product and purchase synchronization

Owner correction, 2026-09-13: Komisio supplies saleable items to the POS; the
completed checkout returns as a fact, not an AI proposal requiring a second
employee. PR91's staged import requirement is superseded. Historical operations
remain readable; new normal imports use the automatic engine path.

## Implemented and testable without a merchant account

1. The owner/admin publishes an explicit POS VAT-rate mapping for the existing
   engine VAT modes. There is no guessed mapping or change to engine tax rules.
2. The engine snapshots accepted, unsold items: frozen description, current price
   in minor units, policy revision and configuration. Each item retains a distinct
   product UUID and variant UUID across retries and price changes.
3. The adapter verifies merchant identity, creates the product through the Product
   Library API, or updates a previously delivered version with its exact ETag.
   Remote changes are held, not overwritten. The outcome is append-only.
4. A purchase from Zettle is minimized and stored with its cursor checkpoint.
   Exact product/variant pairs match within the tenant. Legacy receipts without
   either identifier can use a unique full Komisio label. Unknown provided IDs
   never fall back to a coincidentally matching label.
5. Fully matched supported receipts call the existing `record_sale` automatically.
   Sale status and seller credit are atomic and idempotent. There is no second
   approver and no AI auto-approval scope. Whole receipts with missing matches or
   unsupported facts stop; staff resolution of the final missing match retries
   the whole receipt automatically. Imported amounts are never edited.

The UI shows receipts, waiting products, product attempt history and configuration.
A bounded pass reads one purchase page first, then sends up to five products.
This order reduces stale exports of items already sold. It is not a scheduled
worker. Lost HTTP responses retain the request envelope; replay does not double
seller credit. Catalog jobs bind price, configuration and policy versions.
Identity, membership and MFA remain enforced by SQL; no service-role client is
introduced. Integration evidence is not a second financial ledger.

## Run the complete local journey

Use existing local Supabase (never reset a shared database), apply additive
migrations and run `node scripts/configure-local.mjs`. The command
`node node_modules/@playwright/test/cli.js test tests/e2e/zettle.spec.ts` starts
both the app and the local HTTP simulator. It creates two accepted items,
configures a synthetic VAT mapping, exports products, updates one price, simulates
checkout in the provider fixture, and imports the sale. It checks automatic seller
credit with one owner, concurrent replay, a lost response, and mobile layout.

For manual local use, start `node --import tsx tests/fixtures/zettle-server.ts`
with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, then run the app with
`KOMISIO_INTAKE_ENABLED=true` and `KOMISIO_ZETTLE_FIXTURES=true`.
Open `/intake/integrations`, configure the test VAT mapping, and sync accepted
items. The test-only simulator accepts `POST /_test/sell` on port3456 with
`Authorization: Bearer fixture:<local-tenant-uuid>` and body
`{"ids":["exported-product-uuid"]}`. Sync again to see the automatic sale.
This endpoint is local test infrastructure, not a Komisio checkout feature.
The Playwright test demonstrates the exact request and assertions.

Both app and database must be loopback for the fixture connector. Never enable
fixtures in staging. The simulator binds only127.0.0.1 and uses original synthetic
payloads; these are not merchant recordings or proof of live interoperability.

Relevant tests: `tests/unit/zettle*.test.ts` (mapping and HTTP contracts),
`supabase/tests/0051_zettle.test.sql` and `0052_zettle_catalog.test.sql` (SQL
identity/immutability/financial boundaries), and `tests/e2e/zettle.spec.ts`.
Migrations through20260915008000 have been applied locally and are immutable.
Release CI and staging evidence belongs in the PR and private checkpoint.

## Before live use

Zettle documents no sandbox. A merchant/developer app is needed for a controlled
live acceptance test, not for the simulator above. The app deliberately has no
live credential activation yet. Remaining work:

- OAuth consent, encrypted refresh/revocation and durable merchant-to-tenant
  binding. The HTTP adapter already checks `/users/self` but is not a credential
  lifecycle or background service.
- Stable purchase windows, overlap, reconciliation and durable retry scheduling.
  `lastPurchaseHash` is a page cursor, not a verified incremental watermark.
- Inventory tracking and initial stock1 for each unique item, delisting/ending
  items and return handling. Product Library export alone is not inventory
  synchronization. Inventory movement identifiers are not documented idempotency
  keys; do not blindly replay stock increments.
- Verify each POS VAT mapping, receipts, item label scanning and product response
  fields against the actual merchant. Full PUT refuses external non-empty fields
  it cannot preserve. Review rather than weaken that check blindly.
- Explicit contracts for discounts, refunds, service charges, non-unit quantities
  and changed receipts. Currently they are held without inventing accounting.

No seller e-mail or actual payment is triggered by this connector. A successful
synthetic test does not establish production readiness.

## Staging and rollback

Apply reviewed additive migrations after required CI, then merge through the
protected PR. Staging shows the disconnected state; do not inject synthetic sales.
Verify authentication and origin rejection. If needed, revert the app via PR;
retain immutable evidence and applied migrations, never delete sales as rollback.
