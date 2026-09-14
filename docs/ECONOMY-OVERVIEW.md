# Economy overview

One read model for the store's numbers over any period, computed in SQL from
the same facts and with the same sums as the day close. It is the source for
the economy page and for any brief a person or an agent writes; nothing here
records or changes a fact.

## Read

`economy_summary(tenant, from, to)`: inclusive local dates
(Europe/Stockholm), at most one year apart; any member of the store may call
it, read-only members included. It returns:

- `totals`: sales and line counts, gross, VAT, net (gross minus VAT),
  commission and VAT on commission, seller credit, returns and refunds, credit
  reversed, payouts paid (count and amount), and the same per VAT mode. These
  are the day close's sums applied to the period: completed sale lines by the
  sale's time, returns and credit reversals by their time, payouts by the time
  they were marked paid. A one-day period equals that day's close totals.
- `days`: one row per local selling day with sale count, gross and seller
  credit.
- `liability`: the store's current position towards all sellers, not limited
  to the period: available, reserved by approved payouts, owed in total, and
  how many sellers have ledger entries.
- `openPayouts`: count and amount of payouts still requested or approved.

Refunds are reported next to gross, never netted into it, so the page and the
day close read the same way.

## Surfaces

- `/intake/economy`: period form (defaults to the current month), totals,
  per-mode table, liability, per-day table. Links to the payouts page.
- MCP `komisio_read_economy_summary` under `economy:read`: the same read
  with `{ from, to }`; amounts are öre, no seller names. An agent that writes
  a weekly or monthly brief reads this and renders it; the brief is text, not
  a fact.

## Brief

`economy_brief(tenant, kind, anchor)` with kind `week` (Monday to Sunday) or
`month` (calendar month) returns the summary totals for the period containing
`anchor` (any local date; null means yesterday) and for the period before,
the best selling day, items accepted in both periods, and the current
liability and open payouts. `renderBrief` in `lib/engine/brief.ts` turns
that into fixed sentences (percent change of gross against the previous
period, best day, selling days, returns and their rate, seller credit and
commission, payouts paid, items accepted, liability, open payouts) in the
reader's language. The same numbers always render the same text: no model
writes the brief, and nothing is stored. Shown on `/intake/economy` (weekly
by default, `?brief=month` for the month) and read by agents through
`komisio_read_economy_brief` under `economy:read`, which returns the English
sentences together with the numbers.

## What this does not do

No forecasts, no per-seller ranking (the seller page
and the seller economy tools cover one seller), no currency other than SEK,
no cached snapshots: every call recomputes from the facts.

## Verification

`supabase/tests/0066_economy_brief.test.sql`: week and month bounds in local
time, previous periods across month and year ends, leap February, best day.
`supabase/tests/0054_economy_summary.test.sql`: period boundaries in local
time, agreement with the day close totals for one day, refunds and reversals,
liability and open payouts, range and membership refusals.
`scripts/test-seller-economy-mcp.mjs` reads the summary through the MCP
boundary and refuses bad periods and extra arguments.
