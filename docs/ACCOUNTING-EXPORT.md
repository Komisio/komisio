# Accounting export

Day closes leave Komisio as SIE 4 vouchers under the tenant's own account
map. Owners/admins can request AI suggestions for blank account mappings,
review and edit them, then explicitly save a new map. Suggestions do not
create postings or change the store VAT policy.

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

The accounting page separates Day closes, Exports, Reconciliation, Account map,
and Settings. Day closes reveal each voucher preview on demand. Exports contains
SIE downloads and Fortnox send/recovery status. Settings contains automatic
preparation, file export guidance and the Fortnox connection. Older account-map
links redirect to the dedicated tab.

## AI account suggestions

The explicit suggestion action uses the configured AI provider and shared AI
credits/quota. The server pins the current map and policy, sends only their
accounting context, and validates structured output against known amount keys
and a limited catalog of BAS 2026 account identities. No seller or transaction
personal data is included. BAS identities are reference data, not an approved
posting profile: settlement accounts, overlapping totals, returns, missing
counterentries and responsibility for POS-posted sales still require review.

Attempts and results are immutable and tenant scoped. The low-risk staged
`useAccountingDraft` operation only authorizes copying suggestions into blank
editor fields. Existing saved and unsaved mappings are preserved. Publication
still uses the explicit owner/admin `publishAccountingMap` command. A stale
map or policy prevents applying a draft; lost responses reuse the same attempt
and decision IDs. Unknown outcomes cannot trigger a second generation silently.
The existing export balance check and absolute-amount/fixed-side arithmetic remain.

## Paid-payout counterpart

`payoutsPaidCounterpartOre` exposes the same paid amount as `payoutsPaidOre`.
The store explicitly maps both keys to distinct accounts on opposite sides;
neither account is inferred. A nonzero paid payout requires the complete pair,
even when the mapped sales subset would otherwise balance. Days without paid
payouts retain their existing mapping behavior. Requested or approved payouts
do not enter the paid total; the existing payment confirmation date is unchanged.

Legacy single-key maps remain readable and immutable but need a new reviewed
map before exporting a day with paid payouts. Frozen exports remain unchanged.
The e-conomic map may explicitly exclude both payout keys when the complete
payment is posted elsewhere; excluding just one leg is refused. Existing
zero-rate VAT-code validation still applies to every posted e-conomic line.

This projection is the first implementation slice of #561, not a completed
automatic payout-accounting workflow. Release still requires Fortnox safeguards
across revised daily exports and an explicit transition for historical exports.
Paid-payout traceability and operator guidance remain in scope. No bank transfer,
bank-statement match or new automatic export/send permission is introduced.

Reference: [BAS 2026, version 1.1](https://www.bas.se/wp-content/uploads/2026/04/BAS_kontoplan_2026_v2.pdf),
account identities checked 2026-10-14. AI suggestions are not accountant approval.

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

`supabase/tests/0315_accounting_ai.test.sql` and
`0316_accounting_ai_credits.test.sql` cover tenant/role/MFA boundaries,
immutable output, candidate validation, stale context, credits and absence of
publication side effects. `scripts/accounting-assistance-race.mjs` covers
concurrent reservation, completion and decision replay. Unit transport tests
use synthetic responses; browser tests exercise real engine staging/approval,
lost replies, preserved unsaved mappings and explicit publication. They do not
establish real-provider accounting recommendation quality.


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
