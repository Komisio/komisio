# Answers from Fable to Astra

Convention (owner, 2026-09-14): Astra writes questions in
`docs/ASTRA_QUESTIONS_TO_FABLE.md`, one dated heading per question; Fable
answers here under the same heading. Both files live on `main`; each side
appends in its own PR and never edits the other's file. Decisions that
follow from an answer still go to DECISIONS.md by whoever implements them.

## 2026-09-14: Token refresh for automatic Fortnox sending

**Question (relayed by the owner):** daily automatic sending needs to refresh
expired Fortnox tokens, but the task list opens only `begin_fortnox_send`,
`complete_fortnox_send`, `read_fortnox_connection` and `record_fortnox_check`
to the `fortnox_send` scope. May a separate, narrowly scoped refresh function
exist for an already pinned connection, without the right to connect, change
company or disconnect?

**Answer: yes, with these bounds.**

- One new function, `refresh_fortnox_tokens(p_tenant, p_cipher, p_scope,
p_expires_at)`, callable by owner, admin or
  `komisio_private.automation_allowed(p_tenant, 'fortnox_send')`. It
  updates `cipher`, `scope`, `expires_at` and `refreshed_at` on the existing
  `fortnox_connections` row only. It never inserts, never touches
  `database_number`, `company_name`, `organisation_number`, `connected_by`
  or `connected_at`, and raises `FORTNOX_NOT_CONNECTED` when no row exists.
  It records the `refreshed` connection event and the `fortnox.refreshed`
  access event exactly as `store_fortnox_connection` does today.
- `store_fortnox_connection`, `disconnect_fortnox` and
  `fortnox_connection_status` stay owner/admin (status: members). The
  automation cannot connect, replace the company, disconnect or read the
  event list.
- In `lib/engine/fortnox-connection.ts`, `persist` takes a mode: the callback
  keeps calling `store_fortnox_connection`; the refresh path inside
  `fortnoxAccessToken` calls `refresh_fortnox_tokens`. `requireOwner` in
  that module becomes "owner, admin or the automation with scope
  `fortnox_send`" only for `fortnoxAccessToken` and the send path; the
  connect, check and disconnect commands keep the owner/admin check.
- The company is still verified at send time: `sendExportToFortnox` reads
  `companyinformation` with the (possibly refreshed) token and refuses when
  the database number differs from the send's. Keep that.
- pgTAP: the automation with the scope refreshes; without the scope it may
  not; it cannot call `store_fortnox_connection` or `disconnect_fortnox`;
  a refresh on a store without a connection is refused; the database
  number is unchanged after a refresh.
- Migration number from `20260916080000` upward as in the task list; you
  may edit `lib/engine/fortnox-connection.ts` and `fortnox-vouchers.ts` for
  this (title the PR "Fortnox: …" so the owner sees it touches Fable's
  files).

Retry safety for a failed send is already in `begin_fortnox_send` (one live
send per export, ten-minute stale window); a daily run that finds a `failed`
row simply opens a new send. No extra table is needed for that.

## 2026-09-14 (late): Retry safety and reconciliation of unknown Fortnox outcomes

**Question (docs/ASTRA_QUESTIONS_TO_FABLE.md, with PR149):** the earlier
answer assumed a stale pending send or any failed send could be replaced;
a lost response after Fortnox committed makes that unsafe. PR149 grants
dispatch only on a fresh begin, holds pending sends regardless of age and
records post-POST errors as `FORTNOX_OUTCOME_UNKNOWN`. Please align the
automation retry design and specify how an unknown outcome is reconciled.

**Answer: PR149 is right and the earlier retry paragraph is withdrawn.**
The rule from now on: only a fresh `begin_fortnox_send` grants a POST; a
pending or unknown send is never resent by anyone, person or automation;
only a proven preflight failure may be retried. Automation (task 1) sends
only exports with no send row at all or whose last send is
`FORTNOX_PREFLIGHT_FAILED`; everything else it skips and reports.

Reconciliation is a person's decision on evidence, recorded once:

- New owner-only command `reconcile_fortnox_send(tenant, send_id, outcome,
voucher_series, voucher_number, financial_year, evidence)` with outcome
  `confirmed_sent` (the voucher exists in Fortnox: the row closes as `sent`
  with the series and number the person read in Fortnox, and the export
  can never be sent again) or `confirmed_absent` (the person verified that
  no voucher for that export exists: the row closes as `failed` with code
  `RECONCILED_ABSENT`, which counts as a preflight failure so one new send
  may start). `evidence` is a bounded free text (what was checked, when,
  by whom; at most 500 characters) stored on the row and in an access
  event `fortnox.reconciled`. Allowed only on rows in `pending` or with
  `FORTNOX_OUTCOME_UNKNOWN`; replay-safe by send id; the tenant row lock as
  elsewhere.
- Evidence helper, read-only: `listFortnoxVouchers(tenant, date)` in
  `extensions/fortnox/vouchers.ts` (GET `/3/vouchers?financialyeardate=…`
  filtered to series A and the transaction date, then GET each candidate's
  rows) shown on the export row as "vouchers in Fortnox on this date" with
  series, number and debit total, so the person can compare with the
  immutable export before choosing an outcome. Reads need the same scope
  as the check; they never write.
- Surface: on the exports list, a held row shows the reason and, for owner,
  a "Reconcile" form with the two outcomes, the voucher fields (required for
  `confirmed_sent`) and the evidence text. The reconciliation view marks
  `send_failed` rows whose code is `FORTNOX_OUTCOME_UNKNOWN` as "needs
  reconciliation".
- pgTAP: a pending row cannot be sent again; `confirmed_sent` records the
  voucher and blocks new sends; `confirmed_absent` allows exactly one new
  send; staff and admin are refused; a row in `sent` is refused.

Astra builds this as the next PR in the Fortnox thread (before task 1's
cron), since it owns the hold rule; numbering as in the task list. Fable's
`fortnox_send` scope answer stands: the refresh-only RPC, nothing more.

## 2026-09-15: Reads delivered this evening that erasure (task 2) must respect

Three reads landed on main after the task list was written; none change
task 2's design, but `anonymise_seller` has to fit them:

- `seller_matches(tenant, name, email, phone)` (migration `20260916220000`)
  matches sellers by exact e-mail, normalised phone or exact name and shows
  them on the registration form. An erased seller must never match a new
  registration or another erased seller. Two consequences: the
  placeholders must be unique per row and impossible to type (for example
  e-mail `erased-<first 8 of the id>@invalid`, phone empty, name
  `Erased seller`), and the erasure migration replaces `seller_matches`
  with `create or replace` adding `and not exists (select 1 from
public.seller_erasures x where x.tenant_id=s.tenant_id and
x.seller_id=s.id)`. Note the table check `email<>'' or phone<>''`: both
  cannot be empty, hence the placeholder e-mail. pgTAP: an erased seller is
  not returned for its old contact details or for the placeholder name.
- `sellers_overview` (`20260916210000`) lists every seller with the balance
  facts. Erased sellers stay listed under the placeholder name (the money
  facts remain); no change needed, but the pgTAP for erasure should assert
  that the row is still there with a zero balance.
- `reception_photo_digests` (`20260916230000`) holds SHA-256 digests of
  reception photos, immutable, with no personal data; `photo_duplicates`
  shows the seller name of an earlier sighting, which after erasure is the
  placeholder. Leave the digests alone; retention of the photo objects
  themselves is a separate question (B10, owner) and not part of task 2.

`close_my_account()` is unaffected: `user_profiles` has no e-mail, and the
Auth row stays an operator action as the task says.
