# Live Zettle receipt retrieval

## Real merchant verification log

Append one row after each real provider action. Record the action date in
Europe/Stockholm, the minimal payload description, observed provider/POS result,
reconciliation and evidence source. If only the report date is known, say so;
never turn a unit test, API acknowledgement or a database migration into POS
acceptance evidence. Keep credentials, raw receipts, customer details and exact
merchant/item identifiers out of this public log; retain correlation privately.

| Date / evidence | Action and minimal data sent | Observed Zettle result | Reconciliation / limit |
| --- | --- | --- | --- |
| Report recorded 2026-09-14; owner report in this conversation; action date not supplied | Exported one test article from Komisio to the pilot POS; exact payload and correlation not retained here | Owner saw the article in Zettle POS, without inventory tracking and without a product image | Product appearance is owner-reported, not independently reproduced. Stock and image appearance after the fixes remain unverified. No manual stock adjustment is confirmed. |

No real receipt pull, matched sale or image upload was performed during this
follow-up implementation. Their verification rows must be added when those actions
actually occur, with POS observation recorded separately from HTTP success.

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
page; there is no silent skip or operator close command. The requested provider
interval and its durable watermark do not change. Identical receipt IDs across
overlap windows remain
idempotent; conflicting facts stop the page. Only already-supported, fully matched
purchases record sales and seller credit. Refunds, discounts and unmatched lines
retain the existing held behavior; this adds no tax or commission rule.

## Limits

Two-minute lag and five-minute overlap are operational choices, not a guarantee
against arbitrarily late provider data. Scheduled retrieval, backoff, long-range
reconciliation, refund/discount handling and merchant credential rotation remain
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
