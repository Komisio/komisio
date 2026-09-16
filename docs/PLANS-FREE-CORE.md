# Free core and Butik Plus

Decision by the owner on 2026-09-16 ("alternativ 5"), designed and delivered
by Fable in migration `20260916420000`. It replaces the single paid plan with
a read-only gate described in [ONBOARDING-AND-PLANS.md](ONBOARDING-AND-PLANS.md)
(decisions C1 to C3). The store's own facts are never behind a paywall;
what a store pays for is what saves it time and connects it to other systems.

## The offer

| Tier                   | Price                         | What it holds                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free core              | SEK 0                         | Sellers, reception, items, sales, returns, markdowns, day close, settlements, payouts, statements, SIE and seller data export, Zettle POS, staff, seller self-service, one paired label printer. Up to 100 new items a month.                    |
| Butik Plus (per store) | SEK 199 a month excluding VAT | Everything in the core without the item cap, five paired label printers, Shopify (products out, orders and refunds in), Fortnox, chains with transfers between stores, and the reception assistant (AI proposals, tokens included in the price). |

The self-hosted deployment has no tiers: with billing not configured every
store is Plus. A hosted store created before billing was enabled is Plus as
well, without a row in `tenant_plans`; it drops to the free core only when
the owner closes it or a trial or subscription it later took out lapses.

## Lifecycle

`trial` (30 days of Plus at store creation) → `free` when the trial ends
without a subscription, or `active` with one. `active` → `past_due` (14 days
grace, still Plus) → `free` when grace lapses. A cancelled subscription is
Plus until the paid period ends, then `free`. `free` → `active` at once when
the owner subscribes. Any state → `closed` on the owner's request. The
legacy `read_only` state stays valid for rows the host set by hand; nothing
moves a store into it any more.

The trial-ended notice tells the owner the store continues for free and
what Plus adds; the grace notice says the store returns to the free tier,
not that it stops.

## Where the limits live

Everything is enforced in SQL, once, so the interface, the MCP tools and the
extensions cannot differ:

- `komisio_private.plan_tier(tenant)` returns `plus` or `free`.
- `komisio_private.require_plus(tenant, feature)` raises `PLAN_PLUS_REQUIRED`
  with the feature name in the error detail. It is called by the Shopify
  connection, product export and order import, the Fortnox connection and
  send, the reception assistant reservation, chain creation and joining, and
  transfers (both stores must be Plus). The scheduled Shopify and Fortnox
  automation lists skip free stores.
- The `plan_gate` trigger on `items` counts the store's items accepted this
  calendar month and raises `PLAN_LIMIT_ITEMS` at the hundred and first.
  Nothing else is counted: sales, returns and payouts stay open at any volume.
- `create_print_pairing_code` raises `PLAN_LIMIT_DEVICES` when the store's
  active devices reach the tier's limit (one, five).
- `plan_status(tenant)` reports `tier`, `itemsThisMonth`, `itemLimit`,
  `devices` and `deviceLimit`, so the plan panel and the banner show the
  usage before the cap is hit.

The rejections are shown as plain sentences in the interface (Shopify,
quick reception, printing) and returned as codes to the MCP tools. A refused
item stays unrecorded; the cap never writes a partial fact.

## What is not decided here

- The Stripe product "Butik Plus" at SEK 199 excluding VAT per store and
  month is created by the owner in Stripe (owner action C7); the checkout
  and portal code from slice 2 needs no change, it activates the same
  `tenant_plans` row.
- The marketing site text belongs to the owner.
- A hosted copilot with a token quota (beyond the reception assistant) and
  the hosted MCP connector are later slices; the roadmap keeps them as
  Plus features.
