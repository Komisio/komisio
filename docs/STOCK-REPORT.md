# Stock report

Margin, sell-through and stock age per category for one period, computed
in SQL from the store's own facts. The same numbers serve the page, the
agent tool and, later, the chain view. Read only; nothing is forecast.

## Definitions

- **In stock:** accepted items with no completed, unreturned sale line and
  no `period_ended` event, valued at their current price. Stock is as of
  now, not as of the period.
- **Age:** days from acceptance to now, in four buckets that follow the
  default markdown schedule: 0 to 14, 15 to 28, 29 to 42, 43 and more.
- **Sold:** completed, unreturned lines whose sale occurred in the period
  (inclusive local dates, Europe/Stockholm, at most one year).
- **Margin:** the store's share of a sold line. Consignment: the commission
  in öre. Store-owned: price minus VAT minus the purchase price frozen in
  the item's terms. Margin percent is margin over sold gross.
- **Sell-through:** sold in the period divided by sold plus in stock now,
  as a percent with one decimal.
- **Category:** the origin's category through `komisio_private.item_title`;
  items without one form an empty category shown as "Uncategorised".

## Surfaces

- `/intake/stock` (menu: Money): period form, totals and a table per
  category. Until the migration is live the page says the report is not
  available yet.
- MCP `komisio_read_stock_report` under `economy:read`, same shape as the
  page, amounts in öre.

## Verification

`supabase/tests/0098_stock_report.test.sql`: totals, buckets, per-category
rows including consignment and store-owned margin, sell-through, empty
category, period bounds, no names, outsider refused.

## Current lifecycle overview

`stock_lifecycle_report(tenant, ownership?)` is a separate member-authorized,
MFA-enforced read. The existing period-report and MCP response remain unchanged.
It returns `currency`, `asOf`, `stages` (active, on_sale, markdown_due,
period_ending, period_ended), `nearingPeriodEnd`, and `ownership` totals
(consignment/store, each with `inStock` and `stockValueOre`). The optional
ownership filter applies to every count and value; the other ownership is zero.

All numbers use the existing in-stock definition above. Expired periods remain
in stock until an ending event is recorded. Returns restore eligible stock.
Active combines on-sale, markdown-due and period-ending lifecycle stages;
those stage counts overlap Active and must not be summed with it.

The upcoming-period count is separate from the derived `period_ending` stage:
it includes all in-stock items with `periodEnd > now()` and
`periodEnd <= now() + interval '7 days'`, including pending markdowns. Sold,
ended and already-expired items are excluded. `/intake/items?periodWindow=next7days`
uses the same SQL predicate before counting and pagination. Other filters
intersect it; removing its chip removes only that window. Existing `endsBefore`
remains an inclusive Stockholm calendar-day upper bound without a lower bound.
Counts describe their read time and may change when a period expires or an item
is sold between requests. Stage actions link to the existing lifecycle queue;
these reads execute no lifecycle action or financial write.

`supabase/tests/0358_stock_lifecycle.test.sql` verifies lifecycle/ownership counts,
current-price values, boundary instants, returns, matching paginated lists and
tenant/MFA restrictions.
