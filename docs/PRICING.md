# Software licensing and optional billing

Komisio is open source under the [AGPL](../LICENSE), with the extension exception
in [NOTICE](../NOTICE). Running the software yourself does not require a hosted
subscription. Hosting and external model usage are separate services. Operators
configure their own provider accounts and publish the applicable service terms.

## Where the rules live

- `platform_settings` (one row): `ai_credits_enabled`, `ai_monthly_cap_ore`,
  `ai_included_ore`, `ai_pack_ore`, the reservation per call and the model's
  öre per million input and output tokens. The host edits them under
  Plattform; `set_ai_platform_settings` writes them.
- `ai_credit_events` (append-only): `included` once a month per store,
  `purchased` once per Stripe event, `reserved` before a model call (the
  estimate, negative) and `settled` after it (the correction to the actual
  token cost). `funded_by` says whether a call drew on included credits,
  purchased credits or ran on the store's own key.
- `reserve_reception_assistance` refuses with `AI_CREDITS_EXHAUSTED` when the
  store has neither included nor purchased credits left, and with
  `AI_CAP_REACHED` when the platform-wide cap on included spend is reached and
  the store holds no purchased credits. A refused call leaves no attempt and
  no row. `settle_reception_assistance` records the actual cost; a failed
  call settles at zero, which releases the reservation.
- The platform cap counts only calls funded by included credits: purchased
  credits are money the store paid, so they never stop at the cap. The host
  sees `capUsedOre` for the month under Plattform.
- `ai_connections` holds a store's own key sealed with `KOMISIO_CREDENTIAL_KEY`
  (the same envelope as Shopify and Fortnox tokens); `ai_connection_cipher`
  hands the box to the run, which opens it in the application. A store with
  its own key runs on it and no credits move.
- `record_ai_credit_purchase` is called by the billing actor from the Stripe
  webhook (`checkout.session.completed`, mode `payment`, metadata
  `kind=ai_credits`), once per event id.
- `public_pricing()` is the only anonymous read; it returns general pricing
  aggregates and an empty compatibility list, never store examples.

## Verification

- pgTAP `0112_ai_credits` (32 assertions): included grant, reservation and
  settlement to the token cost, exhaustion with no attempt written, purchases
  once per event and only by the billing actor, purchased credits under the
  cap, own key never metered, everything ungated, public pricing and the
  absence of store examples.
- pgTAP `0110_open_core`: an ended trial changes nothing; 101 items, two
  devices, Shopify and a chain on a store without a subscription; read-only
  still holds.
- Unit tests in `tests/unit/ai-credits.test.ts`; `npm run test:mcp` covers
  the connector without a plan gate.

## Credit purchase currencies

Each one-time purchase adds exactly 100 credits (10,000 internal ore):

| Store country                           | Payment (excl. VAT) | Vercel configuration          |
| --------------------------------------- | ------- | ----------------------------- |
| Sweden / legacy profile without country | 100 SEK | `STRIPE_CREDITS_PRICE_ID`     |
| Norway                                  | 100 NOK | `STRIPE_CREDITS_PRICE_ID_NOK` |
| Denmark                                 | 65 DKK  | `STRIPE_CREDITS_PRICE_ID_DKK` |
| United States                           | 10 USD  | `STRIPE_CREDITS_PRICE_ID_USD` |
| Other ISO countries      | 9 EUR   | `STRIPE_CREDITS_PRICE_ID_EUR` |

These are fixed package amounts in the checkout implementation, not exchange
rates. Store owners or admins select country under Store profile and publish a new version. Existing
profile versions stay unchanged. The server reads the current profile itself;
the browser cannot supply a currency, price ID or credit amount to checkout.
Missing price configuration blocks that currency instead of falling back to SEK.
The configured Stripe price must be active, one-time, and match the displayed
currency and amount. When automatic tax is enabled it must also explicitly use
`tax_behavior=exclusive`. Checkout locale follows the user's app language. The
100-credit pack requires platform `packOre=10000`; changing it disables checkout
until matching pack pricing is implemented. Internal usage and purchased credit
balances remain SEK-denominated. Store sales currency is unaffected.

Create matching prices in the configured Stripe account, set the corresponding
environment variables and rebuild. Verify each supported currency using a
separate test deployment before enabling live purchases.

Recovery: if checkout charges an incorrect price or fails after deployment,
disable purchases for that currency by removing its price setting and redeploying.
Keep support for the optional country field: old strict parsers cannot read newly
published profiles. Any code rollback must retain that compatibility and use the
normal checked PR flow. Keep the additive validator and immutable profile versions;
do not edit granted credit events.

## Stripe Tax

The integration uses one configured subscription Price, not per-market
subscription prices. Credit-pack amounts in the table exclude VAT.
Credit packs retain the amounts in the table above and add exactly 100 credits
regardless of the tax Stripe collects.

`KOMISIO_STRIPE_AUTOMATIC_TAX=true` enables Stripe Tax on both Checkout modes.
Any other value leaves automatic tax off; deploying code alone does not turn it
on. Stripe determines tax from billing information, product classification and
the operator's registrations, never from the store profile or app language.
The profile selects the credit currency only. Customers see tax before payment.

A configured price must explicitly be tax-exclusive when the flag is on. A reused
subscription customer's saved shipping address blocks Checkout until the operator
resolves it in Stripe; Komisio does not change that address. Subsequent renewals
follow Stripe's address hierarchy. Follow [the operator checklist](STRIPE-TAX.md)
in test mode on staging before enabling production.
