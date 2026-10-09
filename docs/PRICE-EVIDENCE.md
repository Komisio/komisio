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
- MCP `komisio_propose_price_change` under `lifecycle:propose`: a new price
  for one accepted item that must cite this read (category, query, days,
  count, median). The tool re-reads the evidence, refuses a stale citation
  and stages a one-item `bulkItemUpdate` at medium risk with the citation in
  the reason; a different person approves.

## What this does not do

No cross-store data (explicit opt-in design first), no external market
prices, no computed suggestion, no image similarity.

## Verification

`supabase/tests/0062_price_evidence.test.sql`: category and text filters,
returned items excluded, median and range, accepted next to sold, the
window, bounds and tenant denial.

## Offline pilot evaluation

Run `npm run pricing:evaluate -- private/pricing-cohort.json` with an explicitly
prepared, anonymized cohort. The tool reads only that local file, makes no AI
or network calls, and prints aggregate metrics without item identifiers.
Keep real observations out of version control. Example input with synthetic data:

```json
{
  "version": 1,
  "marketCountry": "SE",
  "currency": "SEK",
  "observations": [
    {
      "itemId": "10000000-0000-4000-8000-000000000001",
      "currency": "SEK",
      "prediction": {
        "at": "2026-09-01T10:00:00Z",
        "lowOre": 15000,
        "highOre": 25000,
        "basis": "model_estimate"
      },
      "staffDecision": { "at": "2026-09-02T10:00:00Z", "priceOre": 20000 },
      "sale": {
        "at": "2026-09-03T10:00:00Z",
        "priceOre": 16000,
        "returned": false
      }
    }
  ]
}
```

Prediction, staff decision and sale may each be `null`. Keep missing estimates
and unsold goods in the cohort; neither counts as a successful prediction.
Use the original saved estimate, before the staff decision or sale, never a
retrospective rerun. Supported evidence groups are `store_sales`, `web`,
`model_estimate` and `mixed`. Select one market/currency per cohort and include
representative goods rather than only successful sales.

The report separates staff-price agreement from completed-sale accuracy and
excludes returned sales. Error and bias compare the range midpoint to each
outcome; range coverage is reported alongside range width to avoid rewarding
overly broad intervals. Percentages include sample counts; absent comparisons
return `null`, not zero error. Results describe this cohort only: they do not
prove general accuracy or an independent market value, and can be influenced
by staff using the suggestion, markdowns and which goods have sold so far.
