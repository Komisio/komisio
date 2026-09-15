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

## Step 2: products out

`productSet` with one variant per item: title from the item's origin, price
from the current price, sku = the Komisio item id, one unit at the store's
first active location, the reception photo as the product image. Intent
and outcome rows as for Zettle (`shopify_product_exports`), a durable claim
so a lost acknowledgement never creates a second product, and a candidate
list of accepted, unsold items without an export. A markdown updates the
variant price through the same mutation.

## Step 3: orders in

`orders` query with `financial_status:paid updated_at:>cursor` and cursor
pagination, recorded per page as for Zettle. Each line whose sku is a
Komisio item id becomes a sale line through `record_sale` with provider
`shopify` and the order id as external id; a line with an unknown sku holds
the order for a person. Refunds arrive as returns through the existing
return rule. A daily automation run on the automation identity follows once
the manual pull is verified against a real shop.

## Verification

Step 1: `supabase/tests/0099_shopify_connection.test.sql` and
`tests/unit/shopify-connection.test.ts` (domain rule, issues, hmac, code
exchange and shop read against fixtures, state and shop binding, sealed
storage, expired token). No real shop has been connected yet; the first real
connection, export and order pull will be logged here as for Zettle.
