# Agent reads of items and receipts

The roadmap's tool catalogue (section 5) gives the staff agent "find items,
get item summary" and "find receipts, get receipt". This slice delivers
those four reads over the same engine the web uses, and gives the items
page the search it lacked. Nothing here writes; nothing here names a
seller.

## Read

`items_overview(tenant, text, stage, limit)`: members of any role. Returns
the store's currency, the total that matched, and up to 100 accepted items
newest first with:

- id, origin kind and id, seller id, ownership, accepted time;
- title and category from the origin: the inspection draft's description
  and category, the reception review's description and category facts, or
  the purchase's supplier note (the same `komisio_private.item_title` that
  price evidence uses);
- the engine's lifecycle stage (`on_sale`, `markdown_due`,
  `period_ending`, `period_ended`, `ended`, `sold`), the period end, the
  current price in öre and, for sold items, the sale time.

Text matches anywhere in the title or category, case-insensitive, with
`%`, `_` and `\` taken literally. Stage filters on the derived stage. The
sale time ignores returned lines, like the stage does.

Receipts reuse the existing sale reads. `readSales` now accepts an
optional provider, exact external id and status, still at most 50 rows.

## Surfaces

- Items page (`/intake/items`): a search box and a stage filter above the
  list; each row shows the title, category, origin, ownership, stage and
  the current price. Until the migration is live the plain list stands.
- MCP under `items:read`: `komisio_find_items` (the overview) and
  `komisio_read_item_summary` (one item: origin, custody, frozen terms,
  price series, event kinds and times). Free-text price reasons and event
  details stay with the store.
- MCP under `sales:read`: `komisio_find_receipts` (newest sales with
  totals) and `komisio_read_receipt` (one sale with its frozen lines:
  price, ownership, commission, seller credit and VAT per line).

Every response carries `readOnly`, `evidenceIsUntrusted`, `guidanceOnly`
and `amountUnit: 'ore'`; every amount is checked to be an exact integer at
the tool boundary. The read scopes are separate from `items:propose` and
`sales:propose`, so a host can look without being able to stage.

## What this does not do

No seller names or contacts (the MCP still exposes no seller lookup), no
price proposal (the agent cites price evidence and stages a bulk update or
an acceptance as before), no semantic search, no photos, no writes.

## Verification

`supabase/tests/0095_items_overview.test.sql`: titles per origin kind,
stage and sale time, text and stage filters, literal wildcards, limit and
total, invalid input, no names, read-only members, outsider denied.
`tests/unit/items-mcp.test.ts`, `tests/unit/sales-mcp.test.ts` and
`tests/unit/mcp-config.test.ts`: input bounds, truncation marker,
fail-closed amounts, omitted free text, scope separation.
`scripts/test-items-mcp.mjs`: the real stdio server lists and reads the
accepted purchase and its sale under the read scopes only.
