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
