# Live Zettle receipt retrieval

## Current scope

Compatibility: `recordZettlePurchase` is retired
from TypeScript proposals and review UI. Legacy queue rows are omitted and old
review links return not found; SQL history and dispatchers remain unchanged.
Held receipts use the existing matching and retry controls, never a forced sale.
The SQL queue still selects its newest 50 rows before retired entries are filtered.

This slice connects the verified API-key pilot to the existing sale engine.
It is a bounded, manually triggered purchase pull, not a scheduled worker or
product/inventory export. The pilot requires the explicit tenant and merchant
pins described in [ZETTLE-CONNECTION.md](ZETTLE-CONNECTION.md).

## Operation

An owner/admin chooses **Enable receipt retrieval from now**. The server verifies
the Zettle merchant and records its current time as an immutable cutover. There
is no caller-provided backfill date. Retrying activation preserves that cutover.
Changing the merchant requires a separate reviewed lifecycle; a changed pin fails
closed. Removing the pilot environment binding and redeploying disables access.

**Fetch next page** opens or resumes a durable time window and fetches at most
100 receipts. Provider startDate is inclusive and endDate exclusive. The first
window starts at cutover. Subsequent windows overlap five minutes, cover at most
one day and end at least two minutes before server time. An empty provider page
completes the window. Keep requesting pages until the displayed interval completes.

Provider page hashes are stored per window in append-only integration metadata.
They are not used as a permanent time watermark. The old aggregate sync history
uses internal live-page markers so it cannot accidentally reset or reuse a hash
from a different window. Window/page changes and financial reconciliation share
the tenant transaction lock. A lost response replays the stored page under the
same request ID and actor, without fetching a changed page from the provider.

The SQL wrapper accepts purchase timestamps from five minutes before the window
start (inclusive) to five minutes after its end (exclusive), clipped at the
immutable activation cutover. This tolerates bounded provider timestamp skew,
but never imports pre-activation history. More distant timestamps still stop the
page; there is no silent skip. The store-owner recovery below records an explicit gap. The requested provider
interval and its durable watermark do not change. Identical receipt IDs across
overlap windows remain
idempotent; conflicting facts stop the page. Only already-supported, fully matched
purchases record sales and seller credit. Verified whole-line refunds follow the
return path below; discounts and unmatched lines remain held.

## Limits

Two-minute lag and five-minute overlap are operational choices, not a guarantee
against arbitrarily late provider data. Scheduled retrieval, backoff, long-range
reconciliation, partial-refund/discount handling and merchant credential rotation remain
separate work. Product export, inventory initialization and delisting are still
not live. A working token alone does not prove Purchase API permission; the first
actual pull verifies that permission. The merchant must enable the right scopes.

No tokens, provider customer/payment profiles or raw errors are returned to the
browser. Only minimized receipt evidence is persisted. Database membership/MFA,
explicit tenant/merchant pins and exact-origin checks all precede transport access.

## Validation and deployment

Migrations `20260915123000_zettle_live_pull.sql` and
`20260915170000_zettle_pull_tolerance.sql` are additive. Apply them before the
app deployment; do not reset or rewrite existing data. Roll back the app through
a PR and remove the pilot binding if retrieval must stop; preserve recorded facts.

Tests: `0061_zettle_live_pull.test.sql` covers identity, cutover, tolerance
boundaries, completion and replay; multi-connection window/page races
in `scripts/owner-race.mjs`; unit tests for pinned token transport and engine
orchestration; the existing complete synthetic Zettle browser journey with denial
of unconfigured live operations. Test data never uses actual pilot credentials.
## Store-owner window recovery

Only an owner, not an admin, can close the latest unfinished window from the integrations page with
a mandatory reason. The immutable closure is not an empty provider page or a sale.
New pages for that window fail with `ZETTLE_WINDOW_ABANDONED`; previously committed
pages remain replayable. The next window starts at the closed window's exact end.
This deliberately skips the remaining receipts in that interval. Reconcile the
gap against Zettle manually; closing is not proof of a complete import.
The control is hidden during the brief missing-RPC deployment gap.

## Completed POS refunds

The adapter imports refunds already completed in PayPal POS; it does not initiate
customer payments. The documented refund purchase has a negative amount and
quantity, positive unit prices and `refundsPurchaseUUID1` identifying the original
purchase. See the [Purchase API contract](https://developer.zettle.com/docs/api/purchase/api-reference-md).
The original purchase's mutable `refunded` flag does not alter sale facts.

Only exact product/variant matches against a recorded original sale, one returned
unit per line and the full original line price enter the existing return engine.
It reverses consignor sale credit and records returned inventory atomically.
Custom amounts, discounts, ambiguous matches and partial values remain held.
An original sale arriving later retries up to 50 pending linked refund receipts;
staff can also retry a held receipt. Receipt details link to the original sale.

Duplicate pages and concurrent retries cannot reverse credit twice. Fresh
classification evidence supplements immutable legacy blocked receipts rather
than changing them. Return ingestion never increments POS stock: the catalog
adapter must observe remote stock independently under its existing safeguards.

Migrations `20261012170000` through `20261012172000` add integration evidence and
reconciliation. Synthetic database and browser tests cover replay, original-sale
ordering, atomic rollback, worker revocation and concurrent delivery. Real merchant
refund verification is still required. Seller-balance checkout remains deferred
until a supported POS payment flow is verified.

## Manual live-till follow-up

Automated currency/VAT/locale matrices use synthetic loopback fixtures. Record
merchant verification separately; these checks are not completed by CI:

- [ ] Export one item per configured VAT rate; confirm till price, currency and VAT.
- [ ] Sell the item and pull receipts; confirm one matched sale and seller credit.
- [ ] Refund the receipt on the till; confirm reconciliation exactly once.
- [ ] Upload a product image and confirm it on the till.
- [ ] Confirm a title with non-ASCII characters displays correctly.
- [ ] Where available, repeat using a non-SEK merchant account (NOK, DKK or EUR).
