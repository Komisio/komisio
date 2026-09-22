# Shopify adapter

## Online store and Shopify POS

One tenant connection supports the online store, Shopify POS or both. Before
starting sync, the owner/admin chooses an active Shopify inventory location and
the publication for each selected channel. Choices are verified against the
connected shop and saved through the engine with an expected revision. Two
simultaneous saves cannot silently overwrite each other. The setup UI is
translated into all eight application languages.

The first export or order pull locks these choices. Changing channels later
requires a reviewed migration of inventory and order history; there is no
self-service move. Settings survive disconnect, and reconnect cannot bind them
to a different Shopify shop. Previously synchronized connections retain their
legacy behavior until deliberately migrated.

New products receive the printed item reference as barcode, one tracked unit at
the selected location, and publication to the chosen channels. Updates and
recovered products do **not** reset inventory quantities: a price change cannot
replenish a unit already sold in POS. Publication failure records an uncertain
export; retry reconciles the SKU before updating and publishing again. Komisio
does not remove publications managed directly in Shopify.

Orders retain sourceName and retailLocation. With configured settings, new
orders outside the selected web/POS channel are held as channel; POS orders
with another or missing location are held as location. Both remain evidence
and advance the pull cursor. Matching orders use the existing sale and return
rules. Unknown items in mixed carts remain held; POS support does not change
financial rules. Existing recorded orders still receive their refunds.

The UI and synthetic adapter/database tests cover these changes. Real Shopify
POS checkout, scanner behavior and publication permissions require a development
shop acceptance test before claiming live POS support. Shopify inventory policy
alone is not a verified guarantee against overselling across disconnected tills.

References: [Order source and retail location](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order),
[product publishing](https://shopify.dev/docs/apps/build/sales-channels/product-publishing),
[POS inventory](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/track-and-adjust-inventory).

## Store-owned accounts

Each tenant can connect its own myshopify.com shop from /intake/integrations.
The host configures SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET and
KOMISIO_CREDENTIAL_KEY, and registers /api/integrations/shopify/callback
with Shopify. A deployment pilot tenant is no longer required. The registered
app must allow installation by the intended merchants. Owner/admin chooses
the shop; signed state and Shopify's callback HMAC bind authorization to it
and to the tenant. Tokens remain encrypted per tenant. Scheduled order pulls
enumerate accepted tenant grants; connecting does not enable automation.
Provider app approval/distribution is not proven by synthetic tests.


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
  `read_locations`, `read_publications`, `write_publications`;
- the client id and secret as `SHOPIFY_CLIENT_ID` and
  `SHOPIFY_CLIENT_SECRET` in Vercel, plus `KOMISIO_CREDENTIAL_KEY` for tenant token encryption. Existing installations must reconnect to grant publication scopes.

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
  item and one unit at the selected location. Legacy connections without explicit settings use the first active location that fulfils online orders, else the first active one. No photo yet: reception
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
- **Test orders.** A development shop only produces test orders, so a
  deployment says whether they count: `SHOPIFY_ACCEPT_TEST_ORDERS=true`
  (staging only) records them as sales; the evidence still marks them as
  test orders. Production leaves the variable unset and holds them.
- **Refunds as returns (2026-09-15).** Migration `20260916350000`, pgTAP
  `0105`. The order query also covers partially refunded and refunded
  orders (they were paid, so the sale stands) and carries each order's
  refunds: id, time, amount and lines with sku and the refunded amount
  (subtotal plus tax, the tax-inclusive line price when the whole line is
  refunded). Each refund is stored once (`shopify_refunds`); each refund
  line whose sku is a sold Komisio item on that order becomes a return of
  the sale line through the existing return rule, recorded by the private
  return core so the scheduled pull can do it too. What the rule refuses
  (partial amount, line already returned) and what cannot be matched (no
  sale, foreign line) is an outcome row with the code, shown on the order
  and counted as held. A refund never counts as a changed order.
- **Product photo (2026-09-15).** After a product is synced, the item's
  first reception photo (same selection as the Zettle image) is uploaded
  once: `stagedUploadsCreate` (resource IMAGE, POST), the bounded JPEG
  derivative posted to the staged target, `productCreateMedia` on the
  product. One intent row per item (`shopify_product_images`) holds the
  media id or the last failure code; a media id is never replaced. Items
  without a reception photo (purchases, imports) have no image. A photo
  failure never fails the export; the next export retries it.
- **Scheduled pull (2026-09-15).** Migration `20260916340000`, pgTAP `0104`,
  `lib/engine/shopify-automation.ts`, `/api/automation/shopify-pull` every
  quarter hour (`vercel.json`). The owner switches it on per store as an
  automation grant with scope `shopify_pull` (the switch sits under the
  orders section). The scope opens exactly the sealed connection read,
  token renewal, the watermark and page recording, plus the private sale
  core; no export, check, disconnect or retry. One run per store and
  quarter hour is reserved before any request, so a duplicate cron delivery
  never calls Shopify twice, and the run ends as `received`, `complete` or
  `failed`; the outcome must agree with the recorded page. The button
  remains for a pull on demand.

## Verification

Channel/location setup: pgTAP `0147`, unit `shopify-settings`, `shopify-products` and `shopify-orders`, browser `shopify-setup`, and the concurrent settings-save test in `test:concurrency`. Provider calls in these tests use synthetic responses.


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

Refunds and photos: `supabase/tests/0105_shopify_refunds_images.test.sql`
(whole-line refund to return, replay stores nothing twice, partial and
foreign refunds held with the code, refused sale leaves the refund held,
public return command unchanged, image intent per item, product required,
failure then media id, media id never replaced, staff read only) and
`tests/unit/shopify-images.test.ts` (staged upload and media attach, no
photo, already synced, failure codes, refund evidence amounts).

Scheduled pull: `supabase/tests/0104_shopify_automation.test.sql` (unknown
scope refused, no run without a shop, reservation and duplicate delivery,
another tenant denied, what the scope opens and what it does not, outcome
must match the page, sale and page name the identity, revocation closes
every door) and `tests/unit/shopify-automation.test.ts` (received, complete,
duplicate skips Shopify, failure outcome without provider text, cron
boundary: unconfigured, wrong secret, pilot only, sign-out on failure).

Step 3: `supabase/tests/0103_shopify_orders.test.sql` (watermark from the
connection, cursor conflict, replay, request conflict, matched order to
sale, five hold reasons, sold item again held with the engine's code, retry,
changed order flagged once, immutability, staff read only) and
`tests/unit/shopify-orders.test.ts` (öre parsing, evidence shape, mixed
currency, watermark, pull query and page recording, empty page, replay).

The app is registered (A11, 2026-09-15) and the pilot store is bound on
staging.

Real rows against the development shop (owner, staging, 2026-09-15):

| When (Europe/Stockholm) | What                                                            | Result                                  |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------- |
| 2026-09-15              | Connect `komisio-test.myshopify.com` from the integrations page | Connected                               |
| 2026-09-15              | Export one accepted item as a product                           | Synced                                  |
| 2026-09-15 16:14:10     | Test order `#1001`, one line, SEK 59.00, paid in the dev shop   | Order placed                            |
| 2026-09-15 16:14:47     | Pull paid orders (`SHOPIFY_ACCEPT_TEST_ORDERS=true` on staging) | 1 received, `#1001` sale recorded       |
| 2026-09-15 18:17:49     | Refund `#1001` in full in Shopify admin, pull again             | Return recorded on the sale line        |
| 2026-09-15 18:22:38     | Export an item received with a reception photo                  | Synced, photo in Shopify (`I-B687C6C7`) |

Every step (connection, product with photo, order to sale, refund to
return) is verified end to end on staging against the development shop.
Production keeps `SHOPIFY_ACCEPT_TEST_ORDERS` unset.
