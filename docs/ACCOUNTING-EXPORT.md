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

The accounting page shows the map form (owner or admin), a voucher preview
under each recent day close with the balance status and any unmapped amounts,
the export action, and the list of exports with download links and the
Fortnox send state.

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

`supabase/tests/0067_accounting_reconciliation.test.sql`: every status in
order, quiet days left out, export under the current map preferred, a return
after the close makes it stale, bounds and membership.
`supabase/tests/0046_accounting_export.test.sql`: map validation, versioning
and replay, preview without a map, an unbalanced map published but refused at
export, a balancing map exported once per close and map, staff export, owner
only publish, immutability. `tests/unit/sie.test.ts` covers the file format.
Migration `20260914160000`.
