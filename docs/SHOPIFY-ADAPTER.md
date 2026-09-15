# Shopify adapter

Shopify is the second sales channel after Zettle (owner decision B9, after
Zettle is stable). The adapter follows the same contract: accepted items go
out as products with stock and photos, completed orders come back as sales
with the seller's credit computed by the engine, and every provider
interaction is recorded as an intent and an outcome. Nothing is repriced or
paid by the adapter.

## What Shopify requires of Komisio

Shopify no longer allows merchants to create custom apps with a token in
their own admin (checked 2026-09-15). A store connects a registered app
through the authorization code grant, so Komisio needs one app in Shopify's
Dev Dashboard, registered by Inority AB, with:

- redirect URL `https://app.komisio.com/api/integrations/shopify/callback`
  (and the staging origin during the pilot);
- scopes `read_orders`, `write_products`, `write_inventory`,
  `read_locations`;
- the client id and secret as `SHOPIFY_CLIENT_ID` and
  `SHOPIFY_CLIENT_SECRET` in Vercel, plus `SHOPIFY_PILOT_TENANT_ID` for the
  one store allowed to connect during the pilot, as for Fortnox.

New apps get expiring access tokens with a refresh token valid for 90 days.
Step 1 stores both and reads an expired token as "reconnect needed"; token
renewal is step 2 together with the first export, once a development store
exists to verify it against.

Owner actions: register the app and create a development store, then set
the three variables. Until then the integrations page shows which
configuration is missing and nothing is sent.

## Step 1: connection (delivered)

Migration `20260916290000`: `shopify_connections` (one shop per store,
domain pinned, sealed token, scope, expiry, revision) and
`shopify_connection_events` (connected, refreshed, checked, refused,
disconnected). Functions `store_shopify_connection`,
`read_shopify_connection` (owner or admin, ciphertext), `shopify_connection_status`
(any member, never the token), `record_shopify_check`, `disconnect_shopify`.
A direct update or delete of the connection is refused by trigger.

`extensions/shopify/auth.ts`: shop domain rule, authorisation URL, callback
hmac verification (constant time), code exchange at the shop, one GraphQL
call (`shop`) on Admin API 2026-07. `lib/engine/shopify-connection.ts`:
start (signed state naming the shop), complete (state, hmac, shop match,
seal, store), check, disconnect. Routes under `/api/integrations/shopify`.
The integrations page has a Shopify section for owners and admins: enter
the shop's myshopify domain, connect, check, disconnect.

## Step 2: products out (delivered 2026-09-15)

Migration `20260916320000`, pgTAP `0102`, `extensions/shopify/products.ts`,
`lib/engine/shopify-products.ts`, one more action (`exportItem`) on the
Shopify route, and a "Products in Shopify" section on the integrations page.

- **One product, one variant per item.** `productSet` (synchronous) with the
  default option (Title / Default Title), title from the item's origin
  (draft or purchase; the reference `I-XXXXXXXX` when blank), the category
  as product type, status ACTIVE, price from the current price in major
  units, sku `K-<item id>`, `inventoryPolicy: DENY`, a tracked inventory
  item and one unit at the shop's location: the first active location that
  fulfils online orders, else the first active one. No photo yet: reception
  photos live in private storage and Shopify needs a public URL or a staged
  upload; that is a follow-up.
- **Intent before request, outcome after.** `prepare_shopify_product` records
  the payload once per item and price (replay returns the same row); the
  application makes the request; `finish_shopify_product` records `synced`
  with the product, variant and inventory item ids, `failed` (nothing
  reached Shopify, or Shopify refused with user errors) or `unknown` (the
  answer was lost). Both tables are immutable (`IMMUTABLE_SHOPIFY`) and
  readable by every member; only owners and admins export.
- **Never two products for one item.** An export is an update when the item
  has a synced product (the id is carried into the new export row). When no
  product is known, the engine looks the sku up in the shop first
  (`productVariants(query: "sku:...")`), so a lost answer or a product made
  by hand in the shop is updated rather than duplicated; two variants with
  the same sku stop the export (`SHOPIFY_SKU_AMBIGUOUS`).
- **Markdowns.** A new price makes the item a candidate again; the export
  names the known product and `productSet` replaces its variant with the
  new price. Sold and ended items are never candidates.
- **Token renewal.** Expiring offline tokens are renewed two minutes before
  expiry with the refresh token at the same token endpoint; the new pair is
  stored through `refresh_shopify_tokens` bound to the connection revision
  read before the call. A connection replaced in between refuses the store
  (recorded as a `refused` event); Shopify keeps the old refresh token valid
  until the new one is used, so a refused store costs nothing.

## Step 3: orders in (delivered 2026-09-15)

Migration `20260916330000`, pgTAP `0103`, `extensions/shopify/orders.ts`,
`lib/engine/shopify-orders.ts`, route actions `pullOrders` and
`retryOrder`, and an "Orders from Shopify" section on the integrations page.

- **One page per pull.** `orders(first: 50, sortKey: UPDATED_AT, query:
"financial_status:paid updated_at:>='<watermark>'")`. The watermark starts
  at the connection time and moves to the newest `updatedAt` on the page;
  an order seen again is skipped by its id, so the overlap at the watermark
  costs nothing. Each pull is one request id; a replay records nothing new
  and a request id reused with other content is refused.
- **Evidence, then facts.** `record_shopify_order_page` validates the page
  (`komisio_private.valid_shopify_order`), stores each new order once
  (`shopify_orders`: id, name, time, currency, amount, status flags, lines
  with sku, description, quantity, line total), matches each line's sku
  `K-<item id>` to an item of the store, and records the sale for an order
  whose lines all match, one unit each, in the store's currency, paid, not
  cancelled, not a test order: `record_sale` with provider `shopify`, the
  order id as external id and the order name in the reference. Anything
  else is held with a reason (`test`, `cancelled`, `financial_status`,
  `currency`, `quantity`, `unknown_sku`, `missing_item`, `ambiguous_item`).
  A sale the engine refuses (for example `ITEM_ALREADY_SOLD`) is an outcome
  row with the code; `reconcile_shopify_order` retries it later. An order
  whose amount, lines or status changed in Shopify after it was stored is
  flagged once (`SHOPIFY_ORDER_CHANGED`) and left to a person; refunds are
  not turned into returns yet.
- **No automation yet.** The pull is a button for owners and admins. A
  scheduled pull on the automation identity follows once the manual pull is
  verified against the dev store, as for Zettle.

## Verification

Step 1: `supabase/tests/0099_shopify_connection.test.sql` and
`tests/unit/shopify-connection.test.ts` (domain rule, issues, hmac, code
exchange and shop read against fixtures, state and shop binding, sealed
storage, expired token).

Step 2: `supabase/tests/0102_shopify_products.test.sql` (prepare replay per
price, payload shape, outcome validation and immutability, markdown carries
the product id, revision-bound renewal, staff read only) and
`tests/unit/shopify-products.test.ts` (input shape, location choice, create,
update by known id, reconcile by sku, lost answer recorded as unknown,
refusal recorded as failed, no location, renewal before export, reconnect
without refresh token, connection changed under renewal).

Step 3: `supabase/tests/0103_shopify_orders.test.sql` (watermark from the
connection, cursor conflict, replay, request conflict, matched order to
sale, five hold reasons, sold item again held with the engine's code, retry,
changed order flagged once, immutability, staff read only) and
`tests/unit/shopify-orders.test.ts` (öre parsing, evidence shape, mixed
currency, watermark, pull query and page recording, empty page, replay).

The app is registered (A11, 2026-09-15) and the pilot store is bound on
staging. No real connection or export has been recorded yet; the first real
connection, export and order pull will be logged here as for Zettle.
