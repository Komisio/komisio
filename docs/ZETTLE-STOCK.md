# Zettle stock: implementation checkpoint

Status: real product export/read-back verified through PR108, 2026-09-13.
The first stock attempt is held; PR109 exposes safe live diagnostics. The next
compatibility patch accepts an empty tracking record list and reads physical
STORE balance only. No successful live stock initialization is claimed yet.

The owner wants an accepted Komisio item exported to Zettle, sold at the POS,
and the completed sale imported automatically. A unique second-hand item needs
one unit of tracked stock. Receipt pulling is already implemented separately.

## Verified foundation

`extensions/zettle/inventory.ts` provides bounded requests to the official
Inventory API, strict merchant/product/variant checks on stock evidence,
unambiguous inventory discovery and an explicit one-unit movement primitive.
It never retries a movement. Network errors are replaced with fixed codes.
An unexpected pagination link holds the operation; it is neither followed nor
ignored. Multiple STORE inventories require a later explicit selection design.

The movement identifier is correlation, not an assumed idempotency guarantee.
The adapter alone is **not safe to expose as a retryable operation**; the route
uses `exportZettleItem` in the engine, which obtains the durable SQL claim. Zero stock
after a lost response cannot establish that the original movement did not occur.
`mayInitialize` is only a snapshot predicate, never authorization to retry.

Unit cases cover physical stock classification, changed stock, ambiguous inventory
roles, identity mismatches, empty/new tracking records, malformed evidence, uncertain
writes and safe errors. Engine cases also cover response loss, stopped invocations, snapshot changes,
role checks and replay. The catalog factory keeps its credential lease private and
revalidates the merchant on refresh. Real inventory discovery and tracking reads
have been exercised; a root-level tracking response failure held the pilot.
An empty successful status list means no enabled record, not permission to retry
an old initial movement. Virtual inventories are not invented stock counters.

## Implemented engine contract and release checks

1. Immutable integration intent/outcome metadata, not a new financial core, is
   provided by migration `20260915143000_zettle_stock.sql` (applied locally; immutable).
   Bind each intent to tenant, item, merchant, product, variant, inventory IDs and
   actor. A unique tenant/item claim permits at most one initial movement across
   request IDs, retries and price updates. Only the invocation that commits a
   new claim may write; a replay of even the same request is read-only.
2. Require owner/admin and the existing identity/MFA boundary in SQL. Verify
   tenant and merchant pins before any provider access. Preserve the current
   accepted-item, lifecycle, price, policy and explicit POS VAT checks.
3. Reuse conditional product export. Commit the stock claim before acknowledging
   product completion, so a lost claim response cannot hide an unfinished item
   from both the candidate list and the stock list. Commit before enabling
   tracking or moving stock. Revalidate the current export immediately before
   the first movement. Do not re-enable externally disabled tracking on replay.
4. Reconcile uncertain results by reading tracking and stock. A known single
   unit in STORE may be recorded as available/initialized. Zero remains unknown,
   never inferred as a sale or permission to restock. Other physical balances
   conflict with the one-item pilot. Sales require matched Purchase API facts. Do not make
   an automatic second movement after an uncertain result or a process crash.
5. Record safe outcomes and expose a bounded, one-item manual export action
   on the integrations page for the pinned pilot owner/admin.
   Persisted failures must remain discoverable even after product export has
   succeeded; the existing unsynced-product candidate list alone is insufficient.
6. SQL role/tenant boundaries and concurrent claim winners pass pgTAP (26 stock
   cases plus the structural tenant sweep) and multi-connection tests. Exercise crashes before/after movement, lost responses,
   changed price/policy, expired credentials and sale interleaving in engine tests.
   A cross-system transaction is not available: document residual concurrent POS
   risks instead of claiming atomicity.
7. Run normal CI, additive migration and backup exercise, protected merge and
   staging verification. Do not reset the shared local database or reuse a
   migration number allocated by another branch.

For a real outbound test the owner must select an accepted test item and configure
the correct POS VAT mapping. Do not invent VAT settings to unblock export.
Returns/restocking, lifecycle delisting and scheduled exports remain separate
work required before an external pilot. This foundation does not deliver them.

## Protocol references

- [Inventory API reference](https://developer.zettle.com/docs/api/inventory/reference)
- [How inventories work](https://developer.zettle.com/docs/api/inventory/concepts/how-inventories-work)
- [Tracking](https://developer.zettle.com/docs/api/inventory/user-guides/manage-inventory-tracking/enable-disable-tracking)
- [Balance movements](https://developer.zettle.com/docs/api/inventory/user-guides/manage-inventory-balances/update-inventory-balance)

The credential lease must remain private to the connected adapter factory, with
merchant validation on token refresh, as in the receipt client. Do not expose a
token to the route, UI, diagnostics, logs or test fixtures.

## Verification checkpoint

357 unit tests, TypeScript, ESLint, formatting and the production build pass for
the physical-stock/new-tracking patch, as does the local Zettle browser journey.
CI must also pass before merge. No SQL or claim permission changes in this patch.

The initial stock release passed stock/tenant SQL and multi-connection tests.
Its restore exercise reproduced row counts for all 59 application tables, with
19 platform restore errors; that was not proof of a full platform restore.
Real product UUID recovery and numeric VAT read-back are verified. The existing
unknown stock intent remains immutable and may require explicit manual
reconciliation; do not delete it or create a second product to bypass it.
