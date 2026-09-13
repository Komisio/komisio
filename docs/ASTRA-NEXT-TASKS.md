# Next tasks for Astra

Written 2026-09-13 by Fable (lead architect) at the owner's request. Priority
order. Same conventions as P1-SLICES.md and P2-SLICES.md: one PR per task,
decision lines and pgTAP first, additive migrations, engine command, thin
surface, tests. Base every branch on `main`.

## Coordination

- Migration timestamps: use `20260915000000` and later. Fable's open stack
  ends at `20260914170000`. Before choosing a version, list
  `supabase/migrations` in both checkouts and `origin/main`, and query
  `supabase_migrations.schema_migrations` on the local database; the
  20260914110000 collision on 2026-09-13 cost an afternoon.
- Fable's open stack (PR83 → PR84 → PR85, plus the MCP accounting PR that follows) still touches
  `lib/engine/operations.ts`, `lib/engine/operation-review.ts`,
  `components/intake/operation-queue.tsx`, `mcp/server.ts`, `mcp/config.ts`,
  `mcp/proposals.ts`, `mcp/README.md`, `scripts/test-proposals-mcp.mjs`,
  `app/api/operations/route.ts`, `app/api/intake/route.ts`,
  `lib/engine/intake.ts` and the `operations` and `accounting` blocks of
  `messages/*.json`. Avoid those files until the stack is merged; everything
  else is free.
- Do not add a staged operation kind: the dispatcher recipe re-declares five
  functions per kind and two authors doing it in parallel conflict every time.
  Ask Fable, or wait for the stack.
- Blocked on the owner, not on code: Zettle credentials, a connected Fortnox
  account, Resend keys and the pilot mailbox allowlist, a printer for the
  pilot store. Do not invent any of them.

## 1. Seller side of the economy (S15, S16, S18, seller half)

Purpose: the seller sees and acts on its own money in the seller app.

- Reads under the seller identity (the seller review token or the seller
  app session, whichever Komisio.App uses): balance and reserved amount,
  ledger entries, statements list and one statement's lines, communication
  log. Same numbers as the store sees, computed by the same SQL.
- `request_payout` callable by the seller for its own seller row: at most
  available, at least the policy threshold; replay-safe; the payouts page
  shows who requested (seller or staff). No approval or payment from the
  seller side, ever.
- A per-seller notification preference (opt out of automatic e-mails), read
  by `lib/communications/dispatch.ts` before sending; a skipped send is
  logged with `why: 'seller_opt_out'`.
- Tests: pgTAP for identity boundaries (a seller cannot read another seller,
  cannot approve, cannot exceed available), unit tests for the app mapping.
- Migration: yes, `20260915…`.

## 2. Browser journeys for the P2 surfaces

Purpose: the platform CI proves the new pages, not only the SQL.

- Operations queue and detail with the new kinds: return, ledger
  adjustment, markdown batch, bulk item update with the preview table,
  payout approval and payment, message, day close export; approve, reject,
  stale hint.
- Accounting page: publish a map, see the preview balance, export, download
  the SIE file and check its first lines.
- Settings: notifications switch, monthly assistance quota, usage section;
  sale periods page: manual price form.
- Keep them stable: the onboarding step already flakes; prefer role and
  label selectors and the existing 15 second expectation timeout. No new
  fixtures that depend on wall-clock dates.

## 3. Batch reception (S20)

Purpose: one photo set for one seller becomes several garments.

- The model splits the set into garment candidates and proposes each with
  the existing reception contract (sources cited, price with evidence or a
  question); staff confirm per row; every confirmed row is the same staged
  `publishReceptionReview` per garment, nothing new in SQL authority.
- Pure split contract in `lib/assistance/` with unit tests on fixtures; the
  reception page gets a batch mode; the assistance port stays the single
  entry.
- No new tables unless the batch needs an identity for the set; if so, one
  small append-only table and a pgTAP test.

## 4. Zettle pull behind fixtures (S12)

Purpose: everything except the live connection, so the owner's credentials
are the last step, not the first.

- `extensions/zettle/`: a transport interface with a fixture transport that
  replays recorded purchase payloads; a mapper from one purchase to
  `record_sale` with provider `zettle` and the purchase uuid as external id;
  item matching by the label reference; unmatched lines in an
  `unmatched_sale_lines` table with a resolve action that calls
  `record_sale` for that line.
- Sync status and a manual sync on an integrations section; sync cursor per
  tenant; idempotent by external id, which `record_sale` already guarantees.
- Only fields that Zettle documents; when unsure, keep the field out and
  note it. OAuth and the live transport come after the owner provides a
  developer app and a test merchant.

## 5. Usage metering follow-ups (S20)

- Settings page: the previous six months next to the current one, from
  `usage_summary` with a period argument.
- Quotas for seller e-mails and print jobs as policy keys mirroring
  `assistanceMonthlyQuota`; the trigger in migration `20260914100000`
  already reads the policy, so this is a validator change plus the trigger
  branch per feature, and a pgTAP test each.

## 6. Design note before code: duplicate check (S20)

Write the note, not the feature: embedding provider options, storage
(pgvector on the photo row), what leaves the store, cost per photo, how a
dismissed candidate is recorded. The owner picks a provider; then it becomes
a slice.

## Not now

USB print transport (needs hardware), Fortnox API send (needs a connected
account), reconciliation view (needs the send), seller VAT registration
(product decision pending).
