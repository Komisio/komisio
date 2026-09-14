# Next tasks for Astra

Implementation checkpoint, 2026-09-14: owner window escape (PR126), VAT comparison
(PR127), TypeScript staged-kind retirement (PR128), and staff image reads (PR129)
are merged. The dated live-action log records the owner's product observation;
new image, receipt-pull and matched-sale POS observations are not yet confirmed.
Scheduled retrieval remains open pending approval of an authenticated pg_cron to
server-adapter bridge; do not replace that missing transport with an owner session
or a service-role client. No scheduled worker is delivered by the window escape.
The task descriptions below remain the scope and audit trail.

Rewritten 2026-09-14 by Fable (lead architect) after the reviews
[ZETTLE-REVIEW-2026-09-13.md](ZETTLE-REVIEW-2026-09-13.md) and
[REVIEW-2026-09-14.md](REVIEW-2026-09-14.md). The 2026-09-13 list is done:
seller portal (PR88), P2 journeys (PR89), batch reception (PR90), Zettle
pull, live connection, product sync, stock, images (PR91–PR114) and staging
migrations from CI (PR117). Priority order; same conventions: one PR per
task, decision line and pgTAP first, additive migrations, engine command,
thin surface, tests. Base every branch on `main`.

## Coordination

- Migration timestamps: Fable is at `20260915230000`. Take
  `20260916000000` and later, and still list `supabase/migrations` in every
  worktree and on `origin/main` before choosing.
- pgTAP numbers: Fable is at 0066. Start at 0070; glob `supabase/tests`
  across all worktrees first. 0063 collided on 2026-09-14.
- Fable's files today: `extensions/fortnox/*`, `lib/engine/fortnox-*.ts`,
  `lib/engine/brief.ts`, `lib/platform/credentials.ts`,
  `app/api/integrations/fortnox/*`, the accounting and economy pages, the
  `fortnox` and `brief` blocks of `messages/*.json`. Everything else is free.
- Staged operation kinds: still ask before adding one (the dispatcher recipe
  re-declares five functions per kind).
- Deploy ordering: until the owner switches Vercel to a deploy hook fired
  after the `staging-migrations` job, a page read that calls a new RPC must
  tolerate PostgREST `PGRST202` (missing function) the way
  `readZettleImages` does, so the page survives the minutes between the
  application deploy and the migration.
- Blocked on the owner, not on code: payout rail provider (Swish or Stripe
  agreement), Resend keys and the pilot mailbox allowlist, a printer, the
  Vercel deploy hook. Do not invent any of them.

## 1. Window escape and scheduled retrieval (Zettle)

- An owner command that closes a `zettle_pull_windows` row with a recorded
  reason (`ZETTLE_WINDOW_ABANDONED`, reason text bounded) so the next window
  can open when a page fails on every retry. pgTAP: a closed window accepts
  no further pages; the next window starts at the closed window's end.
- Scheduled retrieval: private `komisio_private.run_zettle_pull(tenant)`
  acting as `zettle_pull_connections.created_by`, executable by the database
  owner only, scheduled through pg_cron guarded by extension presence, exactly
  like `komisio_private.run_automatic_markdowns`. No service-role client.
  Record the actor and the run in the existing page tables.

## 2. VAT map shown next to the engine rate (settings)

- On the Zettle catalog configuration form, show the engine's VAT rate for
  each mode (from the store policy and `docs/VAT-CASES.md`) next to the
  mapped percent, and mark a mismatch. No automatic correction: the map is
  the tenant's. Unit test on the comparison; the open question in
  `docs/open-questions.md` stays until the accountant confirms.

## 3. Decide the fate of `recordZettlePurchase`

- Either document it as the manual fallback for a held receipt (then give it
  a button on the held receipt row, owner/admin, staged medium risk) or
  remove the TypeScript branches and the review context. The SQL dispatcher
  stays either way. One PR, one decision line.

## 4. Image read roles

- `zettle_item_image_url` and `zettle_image_status` are owner/admin only while
  the stock export status on the same page is visible to staff. Align the
  read roles (staff read, owner/admin write) with a pgTAP update.

## 5. Live verification log

- After each real merchant action on the pilot store (product export, image
  upload, receipt pull, matched sale), append one dated line to
  `docs/ZETTLE-LIVE-PULL.md` or `docs/ZETTLE-IMAGES.md`: what was sent, what
  Zettle showed, any manual reconciliation. The pilot gate needs this trail.

## Not now

Multi-tenant provider connections (P5 in the roadmap; reuse
`lib/platform/credentials.ts`), Shopify (waits for Zettle live to settle),
USB print transport (needs hardware), payout rails (need a provider
agreement).
