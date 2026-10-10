# Accounting export

Day closes leave Komisio as SIE 4 vouchers under the tenant's own account
map. Komisio proposes no chart of accounts and no postings.

## Shape

| Record               | Meaning                                                                                                     | Mutability  |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| `accounting_maps`    | One published version of the tenant's map: for each day-close amount, an account number and a side, or none | Append-only |
| `accounting_exports` | One export per day close and map version: the recorded voucher lines, debit and credit totals, who exported | Append-only |

The amounts a day close exposes are fixed keys: gross, refunds, commission,
VAT on commission, seller credit, credit reversed, payouts paid, and net and
VAT per VAT mode (all five modes, so a mode change stays visible). The map is
validated in SQL: known keys only, four-digit accounts, `debit` or `credit`.
Publishing is owner or admin, replay-safe by request id, and names the current
map version (`MAP_CHANGED` otherwise); every version stays.

## Voucher

`preview_voucher(tenant, day_close)` turns one day close and the current map
into lines: every mapped amount that is not zero becomes one line with the
mapped account and side and the absolute amount. Unmapped non-zero amounts are
listed as `unmapped`, never folded into a balancing line. The preview reports
debit and credit totals and whether they balance.

`export_day_close(tenant, id, day_close)` records the voucher once per day
close and map version: a repeat, by any staff member, returns the same export.
It refuses a day close without a map (`ACCOUNTING_MAP_REQUIRED`) and a voucher
that does not balance (`VOUCHER_UNBALANCED`). Whether a map balances for a
given day is the accountant's design, not Komisio's; the engine only checks.

## File

`GET /api/accounting/<export id>` renders the recorded lines as one SIE 4
file with a single voucher in series A, dated on the close date and described
as `Dagsavslut <date> v<version>`, debit positive and credit negative, text
reduced to ASCII under `#FORMAT PC8`. The file can be downloaded again at any
time; it is rendered from the recorded lines, never recomputed. A connected
store can also send the recorded lines to Fortnox as one voucher (see
[FORTNOX-CONNECTION.md](FORTNOX-CONNECTION.md)); the file imports into
Fortnox and other Swedish bookkeeping software as it is.

## Surface

The accounting page has three views. "Day closes" (default): generate a
close, a voucher preview under each recent close with the balance status and
any unmapped amounts, the export action, and the list of exports with
download links and the Fortnox send state. "Reconciliation": the period
view described below. "Account map and Fortnox": the map form (owner or
admin) and the Fortnox connection.

## Automatic preparation

An owner can enable **Automatic day closes** in Accounting → Settings. The
`day_close` grant uses the deployment's ordinary automation account and gives
it no export, provider-send or policy-edit permission. The owner can turn it
off from the same control. Deployment never enables a store automatically.

The daily `GET /api/automation/day-closes` job runs at 06:45 UTC with the same
`CRON_SECRET`, `KOMISIO_AUTOMATION_EMAIL` and `KOMISIO_AUTOMATION_PASSWORD`
configuration as other scheduled jobs. Self-hosters schedule that authenticated
request themselves. Only completed Europe/Stockholm days from activation are
included. Quiet days are skipped; days with existing closes are checked again.

Each atomic batch checks at most 31 dates, saves progress with its grant and
rechecks the previous seven processed dates for late imports. After an outage,
further runs advance the backlog. Unchanged totals retain their existing version;
changed totals create a new version. Older late entries still require a manual
refresh in Reconciliation. Runs are serialized with manual closes and grant
revocation; an uncertain response is safe to retry with the same request ID.

The endpoint processes up to 200 eligible stores, oldest run first, within a
200-second launch budget. A failed store does not stop the others. Errors return
500; an exhausted budget returns 503, and remaining work stays eligible. A 200
response with `catchingUp: true` means further scheduled runs are needed. Settings
shows the last checked date for the current grant; it is not proof of export or
delivery. Runtime failures must also be monitored by the deployment operator.

Automatic export creation and complementary POS posting remain separate work.
An accountant still needs to verify the account map and posting responsibility.

## Reconciliation

`accounting_reconciliation(tenant, from, to)` (any member, at most one year)
walks every local day in the period up to today and, for each day with
activity (sales, returns, reversals or paid payouts) or a close, reports one
status: `no_close`, `close_stale` (the day close totals no longer equal the
facts, computed by the same `day_close_totals`), `not_exported`,
`export_outdated` (the export predates the current map), `not_sent`,
`send_pending`, `send_failed` (with the recorded reason) or `sent` (with the
voucher number). The accounting page shows the days needing attention for a
period (current month by default); agents read the full list through
`komisio_read_accounting_reconciliation` under `accounting:read`. Nothing is
written; the person acts on the day close, export or send as usual.

## Verification

`supabase/tests/0289_day_close_automation.test.sql` covers scoped access,
activation boundaries, replay, recent corrections, bounded backlog, revocation
and MFA. `scripts/day-close-automation-race.mjs` covers competing workers,
manual generation and revocation. The browser journey covers owner activation,
an uncertain save, progress display and deactivation; hosted scheduling remains
an operator acceptance check.

`supabase/tests/0067_accounting_reconciliation.test.sql`: every status in
order, quiet days left out, export under the current map preferred, a return
after the close makes it stale, bounds and membership.
`supabase/tests/0046_accounting_export.test.sql`: map validation, versioning
and replay, preview without a map, an unbalanced map published but refused at
export, a balancing map exported once per close and map, staff export, owner
only publish, immutability. `tests/unit/sie.test.ts` covers the file format.
Migration `20260914160000`.
