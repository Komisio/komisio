# Zettle stock: implementation checkpoint

Status: adapter foundation, 2026-09-13. Not wired into the engine, a route or
staging. No product or stock mutation has been made by this slice.

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
The adapter alone is **not safe to expose as a retryable operation**. Zero stock
after a lost response cannot establish that the original movement did not occur.
`mayInitialize` is only a snapshot predicate, never authorization to retry.

33 unit cases cover classification, depletion, changed stock, ambiguous inventory
roles, identity mismatches, tracking, malformed evidence, uncertain writes and
safe errors. The existing authentication and product adapter tests also pass.
No real inventory API exchange is verified yet.

## Next engine slice, before enabling writes

1. Add immutable integration intent/outcome metadata, not a new financial core.
   Bind each intent to tenant, item, merchant, product, variant, inventory IDs and
   actor. A unique tenant/item claim permits at most one initial movement across
   request IDs, retries and price updates. Only the invocation that commits a
   new claim may write; a replay of even the same request is read-only.
2. Require owner/admin and the existing identity/MFA boundary in SQL. Verify
   tenant and merchant pins before any provider access. Preserve the current
   accepted-item, lifecycle, price, policy and explicit POS VAT checks.
3. Reuse conditional product export. Commit the stock claim before enabling
   tracking or moving stock. Revalidate the current export immediately before
   the first movement. Do not re-enable externally disabled tracking on replay.
4. Reconcile uncertain results by reading tracking and stock. A known single
   unit may be recorded as initialized; sold/bin evidence means depleted, never
   restock. Zero or conflicting evidence is held for investigation. Do not make
   an automatic second movement after an uncertain result or a process crash.
5. Record safe outcomes and expose a bounded, one-item manual export action.
   Persisted failures must remain discoverable even after product export has
   succeeded; the existing unsynced-product candidate list alone is insufficient.
6. Prove SQL role/tenant boundaries and concurrent claim winners with pgTAP and
   multi-connection tests. Exercise crashes before/after movement, lost responses,
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
