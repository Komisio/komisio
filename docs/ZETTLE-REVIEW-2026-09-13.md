# Architecture review: Zettle integration

Reviewer: Fable (lead architect), 2026-09-13, at the owner's request. Scope:
everything Zettle on `main` at the end of the day: migrations
`20260915004000` to `20260915163000`, `extensions/zettle/*`,
`lib/engine/zettle*.ts`, the two API routes, the integrations pages, the
pgTAP files 0051, 0052, 0056 (live pull), 0059 (stock), 0060 (identity), the
unit tests and the browser journey. Read-only: nothing was changed by this
review.

## Verdict

The integration follows the hard rules and the roadmap's adapter model. Every
financial fact still goes through `record_sale`; the adapter never writes a
core table; provider payloads are minimised in code before they reach SQL and
validated again in SQL; every command is replay-safe by request id; the
tenant is pinned on the server and the merchant is pinned twice (environment
and `zettle_pull_connections`); credentials and tokens never leave the server
module and error text never carries provider bodies. The owner's correction
that verified POS sales need no second approval is implemented as automatic
reconciliation at import time, with unmatched or unsupported receipts held,
which is the right reading. I found no violation of the hard rules and no
data-isolation gap. The findings below are design points and pilot risks,
ordered by weight.

## Findings

1. **A window can deadlock with no operator escape.** `record_zettle_pull_page`
   refuses a page whose purchase `occurredAt` falls outside the window
   (`ZETTLE_WINDOW_INVALID`), and a window only completes on an empty page.
   If the provider ever returns a purchase timestamped a second outside the
   requested range (clock skew, a different time field, a late-arriving
   receipt), the same page fails on every retry and the store cannot open
   the next window. Suggest one of: accept purchases within the five-minute
   overlap tolerance instead of the exact window, or add an owner command
   that closes a window with a recorded reason so the next one can open.
   Test the chosen rule in pgTAP 0056.

2. **The automatic recording actor is whoever presses "Fetch next page".**
   Fine for the manual pilot. The planned scheduled retrieval cannot call
   `record_zettle_pull_page` without a session identity. The markdown agent
   solved the same problem by acting as the owner or admin who enabled the
   capability (`store_policy_versions.created_by`); `zettle_pull_connections`
   already stores `created_by`, so the same pattern applies: a private
   `run_zettle_pull(tenant)` acting as that person, executable by the database
   owner only, scheduled through pg_cron like `komisio-automatic-markdowns`.
   Do not introduce a service-role client for this.

3. **VAT on the receipt and VAT in the books can disagree.** The catalog
   export sends `vatPercentage` from the tenant's `zettle_catalog_configs`
   map (mode to percent); the imported sale computes VAT from the item's
   frozen VAT mode through `sale_line_facts`. Both are tenant choices, but
   nothing checks that the percent the store mapped for a mode equals the
   rate the engine applies for that mode. Before the pilot, the accountant
   should confirm the map against `docs/VAT-CASES.md`, and the settings form
   could show the engine rate next to each mapped percent. Not a code
   defect; a reconciliation risk for the day close.

4. **`recordZettlePurchase` is a dead staged kind.** After the owner's
   correction nothing proposes it (no MCP tool, no UI); it remains in the
   dispatcher, the zod unions and the review page. Harmless, and removing it
   would need a migration that re-declares the dispatchers, so leave the SQL
   alone; the TypeScript branch and the review context could go in a later
   tidy-up, or stay as the manual fallback for a held receipt if a person
   wants to force a record. Decide and document which.

5. **Test file numbering collides.** Astra's `0056_zettle_live_pull`,
   `0059_zettle_stock` share prefixes with Fable's `0056_tenant_isolation`
   and `0059_markdown_agent` (and 0052 earlier). Nothing breaks, but the
   ordering intent is lost. Rule for both of us from now: check
   `ls supabase/tests` on `origin/main` and all worktrees before numbering,
   and take the next free number; when a collision is found at rebase time,
   the later branch renumbers.

6. **Single pilot credential slot.** `ZETTLE_*` environment variables serve
   exactly one tenant; the docs say so and the code refuses other tenants.
   Correct for the pilot, and the roadmap should carry the multi-tenant
   connection (partner-hosted authorisation, encrypted credential lifecycle,
   rotation, revoke) as an explicit P5 slice so it is not forgotten.

7. **Operational scale of the manual pull.** Windows are at most one day and
   each call fetches one page of at most 100 receipts. A store that pulls
   weekly will click through many pages. Acceptable for the pilot; the
   scheduled run in finding 2 resolves it.

## What I checked and found sound

- Isolation: every new table has RLS with owner/admin (pull, stock) or member
  (catalog, imports) read policies and a restrictive write boundary; the
  isolation sweep covers them automatically and passed.
- Immutability: imports, resolutions, sync runs, windows, pages, exports,
  outcomes, intents and stock outcomes are append-only with triggers; status
  never moves outside SQL.
- Idempotency: purchases by external uuid with a conflict check on changed
  content; overlap windows re-reconcile identical receipts without a second
  sale; product exports keyed by item, price, config and policy version;
  stock initialisation behind a unique intent, one movement per fresh claim,
  read-back decides the outcome, never a retransmission.
- Money: öre as bigint end to end; the catalog price is the engine's current
  price; the sale amount check refuses receipts whose lines do not sum.
- Minimisation: the purchase mapper keeps only documented fields, drops
  payment, customer and employee data, and holds refunds, discounts, service
  charges, non-unit quantities and foreign currency instead of inventing
  allocation rules. Product export sends the item title, sku, barcode and
  price, nothing about the seller.
- Secrets: assertion grant, no client secret, token lease private to the
  module, no logging, fixed error codes, `users/self` verified against the
  pinned merchant on every lease.
- Tests: 41 + 29 pgTAP assertions on import and catalog plus the live-pull,
  stock and identity files; unit tests on auth, HTTP, inventory and mapping;
  race scripts for pull and stock; one browser journey through export, sale,
  automatic credit and concurrent replay.

## Requested follow-ups

For Astra: finding 1 (window escape) before the pilot; finding 2 when the
scheduled pull is built; finding 5 from now on. For the owner: finding 3 with
the accountant, and the pilot merchant scopes noted in ZETTLE-LIVE-PULL.md.
No architectural conflict to record in DECISIONS.md.
