# Next tasks for Astra

Rewritten 2026-09-14 (evening) by Fable (lead architect). The previous list
is done: window escape (PR126), VAT comparison (PR127), retired staged kind
(PR128), staff image reads (PR129), live evidence log (PR130) and scheduled
Zettle retrieval on the automation identity (PR143). Since then Fable
delivered plans and trial (PR138), Stripe (PR140), trial notices from a
daily cron (PR145), the grouped navigation (PR142), the start page (PR146)
and the accounting views (PR147). Priority order; same conventions: one PR
per task, decision line and pgTAP first, additive migrations, engine
command, thin surface, tests. Base every branch on `main`.

## Coordination

- Migration timestamps: Astra owns `20260916080000` to `20260916199999`;
  Fable continues from `20260916200000` (weekly brief took it). List
  `supabase/migrations` in every worktree and on `origin/main` before
  choosing.
- pgTAP numbers: Astra owns 0080 to 0089; Fable continues from 0090. Glob
  `supabase/tests` across all worktrees first.
- Questions to Fable go in `docs/ASTRA_QUESTIONS_TO_FABLE.md`; answers come
  in `docs/FABLE_TO_ASTRA_ANSWERS.md` (the token-refresh answer is there).
- The automation actor is live on staging (identity, `CRON_SECRET`,
  billing actor registered). Scopes are `zettle_pull` and `fortnox_send`;
  task 1 uses the second. The billing actor (platform host of kind
  `billing`) is a different power from a tenant automation grant: do not
  mix them.
- Fable's files: `lib/engine/plans.ts`, `lib/engine/billing.ts`,
  `lib/engine/plan-notices.ts`, `extensions/stripe/*`, `app/api/billing/*`,
  `app/api/host/*`, `components/platform/*`, `lib/platform/navigation.ts`,
  the `plans`, `planNotices`, `nav`, `overview` and `brief` blocks of
  `messages/*.json`. For task 1 you may edit `lib/engine/fortnox-*.ts`,
  the Fortnox migrations' successors and the settings view of the
  accounting page; keep those PRs small and say so in the title.
- Deploy ordering: until the owner's deploy hook is in place, every new
  page read that calls a new RPC tolerates PostgREST `PGRST202`.
- Blocked on the owner: payout rail provider, printer, the Vercel deploy
  hook, the accountant's confirmation of the VAT map. Do not invent them.

## 1. Automatic Fortnox sending (scope `fortnox_send`)

Purpose: a store that has connected Fortnox and switched automatic sending
on gets every recorded export sent as a voucher without pressing a button.

- Migration: re-declare `begin_fortnox_send`, `complete_fortnox_send`,
  `read_fortnox_connection` and `record_fortnox_check` so the role check
  reads `tenant_role in ('owner','admin') or
komisio_private.automation_allowed(p_tenant,'fortnox_send')`. Nothing
  else opens to the automation. pgTAP: automation with the scope may send,
  without it may not, and cannot connect, disconnect or read the status.
- Engine: a function that lists exports without a live send for stores
  whose `fortnox_send` grant is accepted (owner/admin or automation), then
  the existing `sendExportToFortnox` per export as the automation identity
  (the cron route pattern from `lib/engine/zettle-automation.ts`; sign in,
  `acceptAutomationGrants`, run, sign out). One failure stops that store's
  run and is recorded by the existing send row; the next run retries.
- Route `app/api/automation/fortnox-send/route.ts`, `CRON_SECRET`,
  `vercel.json` cron daily at 07:00 UTC (after the day closes of the
  previous day; day closes themselves stay manual in this slice).
- Accounting page, settings view: an owner switch "Send vouchers
  automatically" calling `enableAutomation` / `disableAutomation` with
  scope `fortnox_send`, the grant state, and the last run outcome. Texts
  en/sv in the `fortnox` block. Document in FORTNOX-CONNECTION.md.

## 2. Seller retention and erasure (owner decisions B1 and B3)

Purpose: the store can honour a seller's request and its own retention rule
without touching financial history.

- `anonymise_seller(tenant, seller, reason)`, owner only: allowed when the
  seller has no item for sale, a zero balance and no open statement or
  payout; replaces name, e-mail and phone with fixed placeholders, keeps the
  row and every financial fact, records an access event and an append-only
  `seller_erasures` row (who, when, reason). pgTAP: refused while anything
  is open; the ledger, sales and statements stay; the seller export no
  longer carries contact data. Fit the placeholders and `seller_matches`
  as described in FABLE_TO_ASTRA_ANSWERS.md (2026-09-15).
- A read `sellers_past_retention(tenant)` listing sellers with no activity
  for 24 months and nothing open, shown on the seller pages for owners as a
  list to act on. Nothing is erased automatically.
- `close_my_account()`: the person's own profile anonymised and every
  membership revoked except where they are the last owner (refused with the
  stores named); the Auth row itself is removed by the operator
  (documented procedure, no service key in the app).

## 3. MFA recovery procedure (owner decision B2)

- `docs/OPERATIONS-MFA-RECOVERY.md`: how the store owner verifies the
  person, what the operator does in the Supabase dashboard (remove the
  factor, log it), what the person does next (re-enrol). Add the procedure
  to PILOT-GATES.md and a line to DECISIONS.md. No code unless the account
  page needs a hint text.

## 4. Browser journey for the integrations page

- With the fixtures: the automation switch for `zettle_pull` (grant created,
  accepted state shown after a simulated acceptance through the fixture DB
  helper), the last run outcome, and the staff view without the switch.

## 5. Live verification log

- Keep appending dated rows to ZETTLE-LIVE-PULL.md after each real merchant
  action (first scheduled pull, first matched sale, first image).

## Not now

Shopify (waits for Zettle live to settle), USB print transport (needs
hardware), payout rails (need a provider agreement), Stripe Tax and
production billing (need the operating company).
