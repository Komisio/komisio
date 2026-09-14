# Price evidence

The roadmap's "visual similarity pricing" becomes, in the first step, the
store's own comparable sales: what the store accepted an item at and what it
later sold for. It is evidence for a person or an agent to cite when
proposing a price. It is never a price, never a suggestion, and nothing is
fetched from outside the store.

## Read

`price_evidence(tenant, category, text, days)`: members of any role.
Returns the store's currency, the window, up to twenty sold items (newest
first) with title and category from the item's origin (inspection draft,
reception review or purchase), accepted price, sold price, number of
markdown steps applied, accepted and sold dates and days to sale; plus a
summary with count, median, lowest and highest sold price and average days
to sale. Returned items are excluded. Category matches exactly, case
insensitive; text matches anywhere in the title; either may be empty.

## Surfaces

- Inspection page: a panel under the saved draft, prefilled with the
  draft's category.
- Reception page: the same panel with a small form for category and text.
- MCP `komisio_read_price_evidence` under `reception:read`, marked
  `isNotAPrice`; the agent cites matches in a reception proposal's price
  rationale, and staff still approve.

## What this does not do

No cross-store data (explicit opt-in design first), no external market
prices, no computed suggestion, no image similarity.

## Verification

`supabase/tests/0062_price_evidence.test.sql`: category and text filters,
returned items excluded, median and range, accepted next to sold, the
window, bounds and tenant denial.
