# Payment links for remote sales (spike, #546)

Status: investigation, 2026-10-20. Nothing here is implemented. No migration,
provider account, live key or money flow was created for this spike. No
prototype was built (see [Prototype](#prototype-not-built)).

**Problem.** A store shows an item on Instagram. A customer asks for it in a
direct message. The store needs to send that customer a way to pay for that
item, MobilePay first. PayPal POS used to offer payment links and has removed
them. The payment must land in the store's own account. The item must not be
sold twice. The paid link must become an ordinary Komisio sale, with seller
credit, settlement, day close and accounting export working as they do today.

**Recommendation in one paragraph.** Komisio issues its own short-lived,
unguessable link for one or more held items. When the customer opens it,
Komisio creates the provider payment and redirects to the provider's hosted
page. In DK, FI and NO, and as a card fallback everywhere, the provider is
**Stripe Connect with direct charges on the store's own Stripe account**
(Stripe handles pricing; the store is merchant of record). MobilePay, and
Vipps once it leaves private preview, are enabled on the store's account.
Payments use **manual capture**: Komisio records the sale through `record_sale`
first and captures only if the engine accepted it, so a double sell cancels an
authorization instead of needing a refund. In SE, Swish via Stripe is possible,
but Stripe is then merchant of record (factoring), so it needs the owner's and
an accountant's OK. Swish Handel directly waits for the certificate decision in
`docs/SWISH-PAYOUTS.md`. A direct Vipps MobilePay ePayment adapter is a strong
second provider for stores that already have a Vipps MobilePay agreement. It
should come after the provider-neutral core is in place. For the Danish store
**today**, with no development, Vipps MobilePay's own portal payment links
(1.49 % + 1 DKK) plus a manual sale in Komisio work, with known gaps (see
[Interim](#interim-for-the-danish-store-no-development)).

Store onboarding (§6) supports this choice: Stripe's embedded onboarding takes
the store about 15–25 minutes inside Komisio, with no keys to copy. Vipps
MobilePay direct is close to plug-and-play only if Komisio becomes a Vipps
MobilePay partner. A store's own Shopify (§7) is a good parallel route for
stores that run or want a web shop (MobilePay is native on Shopify Payments in
DK/FI). It needs de-list and sync work before it is safe next to a PayPal POS
till. A central Komisio-operated Shopify is rejected.

---

## 1. Provider options

Fees are as published on the provider's own pages, checked **2026-10-20**. "kr"
is the local krone of the page that was read. Third-party figures are marked as
such. See [References](#references) for the URLs.

### 1.1 Comparison table

|                                       | Stripe Connect + MobilePay / card                                                                                                                 | Vipps MobilePay ePayment (direct)                                                                                                                                                                                              | Swish Handel (Commerce API, direct)                                                                                  | Swish via Stripe                                                                     | Vipps via Stripe                              | Shopify draft order                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| DK                                    | Yes: MobilePay for customers in DK/FI; cards                                                                                                      | Yes (MobilePay app)                                                                                                                                                                                                            | No                                                                                                                   | No (SE customers only)                                                               | Customers in NO only                          | Where Shopify Payments or an app offers MobilePay                   |
| FI                                    | Yes: MobilePay in EUR; cards                                                                                                                      | Yes (MobilePay app, EUR)                                                                                                                                                                                                       | No                                                                                                                   | No                                                                                   | No                                            | as above                                                            |
| NO                                    | Cards; MobilePay only for DK/FI customers                                                                                                         | Yes (Vipps app, NOK)                                                                                                                                                                                                           | No                                                                                                                   | No                                                                                   | Yes, **private preview**                      | as above                                                            |
| SE                                    | Cards; MobilePay only for DK/FI customers                                                                                                         | Swedish users can pay a Nordic merchant through the Vipps app; no SE sales-unit currency listed                                                                                                                                | Yes (SEK)                                                                                                            | Yes, SEK                                                                             | No                                            | as above                                                            |
| EUR stores outside FI                 | Cards; MobilePay for DK/FI customers (EUR is a MobilePay presentment currency)                                                                    | FI sales units only                                                                                                                                                                                                            | No                                                                                                                   | No                                                                                   | No                                            | as above                                                            |
| USD stores                            | Cards only (MobilePay presentment: DKK, EUR, NOK, SEK)                                                                                            | No                                                                                                                                                                                                                             | No                                                                                                                   | No                                                                                   | No                                            | as above                                                            |
| Currencies vs. our five               | MobilePay: DKK, EUR, NOK, SEK. Cards: all five                                                                                                    | WALLET currency must match the sales unit region: DK→DKK, FI→EUR, NO→NOK                                                                                                                                                       | SEK only                                                                                                             | SEK only                                                                             | NOK only                                      | Shop currency (Komisio already refuses a mismatch)                  |
| Published fee                         | DK page: EEA standard card 1.5 % + 1.80 kr, premium 2.8 % + 1.80 kr. MobilePay 1.5 % + 2.80 kr, + 35 DKK/month for Danish businesses (see note 1) | DK: payment links 1.49 % + 1 DKK; integration price not legible on the DK page. NO: integration 2.99 % + 1 NOK, links 2.49 % + 1 NOK. FI: integration 2.49 % + €0.20, links 2.39 % + €0.20. No monthly fee listed for payments | Set by the store's bank. Third-party report: about 2 SEK per transaction and 500 SEK per year                        | SE page: 1 % + 3.00 kr, capped at 7.00 kr. DK page: 1 % + 2.50 kr, capped at 6.00 kr | Not published (preview); card fee + Vipps fee | Shopify Payments or the app's rates (not checked)                   |
| Connect / platform fee                | "Stripe handles pricing": no platform fee. "You handle pricing" (SE page): 15 kr per active account per month + 0.25 % + 5 kr per payout          | None published for partners                                                                                                                                                                                                    | Technical-supplier terms vary by bank                                                                                | as Stripe                                                                            | as Stripe                                     | —                                                                   |
| Store onboarding                      | Create or connect a Stripe account (KYC by Stripe), enable MobilePay in payment-method settings, connect to Komisio by OAuth or Account Link      | Merchant agreement and sales unit with Vipps MobilePay (KYC by Vipps MobilePay); give Komisio API keys, or consent to Komisio as a partner                                                                                     | Swish Handel agreement with the store's bank, a certificate per Swish number (or a technical supplier), Swish number | Stripe account + access request (the docs show an access form)                       | Stripe account + preview access               | Existing Shopify connection                                         |
| Store's own merchant account required | Yes (direct charge on the connected account)                                                                                                      | Yes                                                                                                                                                                                                                            | Yes                                                                                                                  | Yes, but **Stripe is merchant of record** for Swish (factoring addendum)             | Yes                                           | Yes (the shop)                                                      |
| Payout to the store                   | Standard Stripe payout schedule of the store's country                                                                                            | Settlement by Vipps MobilePay to the store's bank (timing not checked; third-party: next business day)                                                                                                                         | Instant to the store's bank account                                                                                  | Standard Stripe payout schedule                                                      | Standard Stripe payout schedule               | Shopify Payments schedule                                           |
| Refund via API                        | Yes, full and partial; MobilePay supports multiple partial refunds                                                                                | Yes, refund all or part of a captured amount                                                                                                                                                                                   | Yes (Commerce API refund, assumed; docs not readable by our tooling)                                                 | Yes, up to 365 days, asynchronous                                                    | Yes, full and partial                         | Through Shopify; Komisio already turns Shopify refunds into returns |
| Manual capture (authorize first)      | Yes, MobilePay and cards                                                                                                                          | Yes (authorize, then capture or cancel)                                                                                                                                                                                        | No                                                                                                                   | No                                                                                   | Yes                                           | —                                                                   |
| Webhooks                              | Signed (`Stripe-Signature`, HMAC-SHA256, timestamp). Connect endpoint carries `account`                                                           | Signed (HMAC-SHA256 over method, path, `x-ms-date`, host, `x-ms-content-sha256`). No documented replay window                                                                                                                  | Callback URL. Authentication assumed to be TLS-based; not verified                                                   | Stripe events                                                                        | Stripe events                                 | Order pull already exists (`docs/SHOPIFY-ADAPTER.md`)               |
| KYC/AML                               | Stripe, on the store's account                                                                                                                    | Vipps MobilePay                                                                                                                                                                                                                | The store's bank                                                                                                     | Stripe                                                                               | Stripe                                        | Shopify                                                             |
| Disputes / chargebacks                | Store's account; card disputes apply to MobilePay. Dispute fee 200 kr (DK and SE pages)                                                           | Vipps MobilePay rules (card-backed; not checked)                                                                                                                                                                               | No chargeback scheme; the customer contacts the store                                                                | No disputes; the customer contacts the merchant                                      | As cards                                      | Shopify                                                             |
| Link lifetime                         | Checkout Session: 30 minutes to 24 hours. Payment Link: reusable until deactivated                                                                | Default 10 minutes. "Long-living" 10 min to 60 days needs special approval: DK on request, FI only for former MobilePay Invoice merchants, NO at most 24 h                                                                     | About 3 minutes to approve in the app (third-party docs)                                                             | Approve within 3 minutes                                                             | as Stripe                                     | `reserveInventoryUntil` on the draft order                          |

Note 1. Stripe's MobilePay documentation lists, per payment, "Stripe processing
fees associated with the card transaction" **and** the "MobilePay transaction
processing fee". The pricing page shows only "1.5 % + 2.80 kr". We read this as
card fee + MobilePay fee (worst case about 3 % + 4.60 kr per payment, plus 35
DKK per month in DK). We have **not verified** whether the two are additive.
Ask Stripe before quoting a price to a store.

### 1.2 Stripe Connect (MobilePay, cards)

- **Model.** Direct charges on the connected account, created with
  `Stripe-Account: acct_…`. The store is the merchant of record. The payment
  appears on the store's account, Stripe fees are deducted there, and refunds
  and disputes are the store's. Stripe recommends direct charges for connected
  accounts with access to the full Stripe Dashboard. In Stripe's older terms
  that is a **Standard** account; current docs describe it through account
  configuration, with Stripe handling pricing and the account using the full
  Dashboard. Express accounts and destination charges (`transfer_data`, with or
  without `on_behalf_of`) put the charge on Komisio's platform balance. Without
  `on_behalf_of`, the platform is the merchant of record. Both are rejected:
  money must not pass through Komisio, and Komisio must not carry negative
  balances, disputes or store-level KYC.
- **Payment Links vs. Checkout Sessions.** Payment Links support direct charges
  (created while authenticated as the connected account). They are reusable
  objects, though, with no per-link expiry, and they need a Product and a Price
  per item. That conflicts with "one item, one buyer, held until expiry". A
  **Checkout Session per link opening** fits better: line items with
  `price_data` (amount fixed server-side), `expires_at` from 30 minutes to 24
  hours, an `expire` endpoint for cancel, `payment_intent_data.capture_method=manual`,
  and `payment_method_types` limited to what the store enabled. Vipps via
  Stripe supports Payment Links only through the API, which matters little
  with Sessions.
- **No application fee.** Komisio's pricing is open core and AI credits
  (`docs/PRICING.md`), so links take no `application_fee_amount`. If the owner
  later wants a fee, direct charges allow one without changing the model.
- **Coexistence with billing.** Today's Stripe account bills stores for
  subscriptions and credit packs (`extensions/stripe/api.ts`,
  `lib/engine/billing.ts`, `app/api/billing/webhook/route.ts`). Connect is
  enabled on the same platform account, which keeps one set of keys. It gets a
  **separate Connect webhook endpoint** and secret (for example
  `STRIPE_CONNECT_WEBHOOK_SECRET`) and a separate route. Billing events and store
  payment events never share a handler. Connect events carry `account`, which
  must equal the account bound to the tenant.
- **What it requires of Komisio (assumed, to confirm with Stripe).** Connect
  platform activation and a platform profile. A Connect agreement covering
  connected accounts in DK, FI, NO and SE (cross-border connected accounts
  inside the EEA are listed as supported; Komisio's platform country is SE).
  Responsibility for the integration, but with Standard-type accounts not for
  store KYC, losses or support of the store's Stripe account. Restricted
  categories: Swish prohibits MCC 5933 (pawn shops) and lists 5947 as
  restricted. A second-hand clothing store is normally 5651 or 5699 and not
  listed, but the MCC is the store's choice in its own Stripe account.

### 1.3 Vipps MobilePay ePayment API (direct)

- **Fit.** Vipps MobilePay's own rails. Komisio would be an integrator, and the
  store keeps its merchant agreement and sales unit. Currency must match the
  sales unit region (DKK, EUR, NOK), so a store's currency in Komisio is checked
  against it at connection time, as Shopify does today.
- **Credentials.** Either sales-unit keys from the store's business portal
  (client id, client secret, subscription key, merchant serial number), sealed
  with `lib/platform/credentials.ts`, or partner keys for Komisio after a
  partner application, used with the `Merchant-Serial-Number` header. Vipps
  MobilePay warns that keys must never be shown to merchants in readable form.
  Partner keys work only in production; the test environment uses test
  sales-unit keys.
- **Lifetime.** A payment request expires after **10 minutes** by default.
  Longer lifetimes need case-by-case approval and differ per market. A DM link
  must therefore not be the provider payment itself. Komisio's link creates the
  ePayment when opened (`userFlow: WEB_REDIRECT`, which returns a
  `redirectUrl`). The same design works for Stripe.
- **Capture.** Authorize first, then capture or cancel. This fits the manual
  capture pattern below.
- **Webhooks.** HMAC-SHA256 with a per-webhook secret over the method, path,
  `x-ms-date`, host and body hash. Vipps MobilePay documents no replay window,
  so Komisio must check `x-ms-date` freshness itself and deduplicate by event.
- **Portal payment links.** A separate product: created by hand in the business
  portal, e-mail notification, no API and no webhook documented. Useful as the
  interim, not for integration.

### 1.4 Sweden: Swish

- **Swish Handel / Commerce API direct.** SEK only. A payment request must be
  approved within about 3 minutes (third-party docs), so again Komisio's link
  creates the request when opened, using the m-commerce flow on a phone or a QR
  code on a desktop. Money arrives instantly in the store's bank account. There
  is no capture step, so a double sell means a refund. Certificates: the same
  question as `docs/SWISH-PAYOUTS.md` §2, "Who holds the Swish certificate": the
  store's own certificate uploaded to Komisio (Komisio holds every store's
  private key), or Inority as a technical supplier with one certificate of its
  own. The answer should be the same for payouts and payment requests. Until
  the owner decides, Swish Handel direct is blocked.
- **Swish via Stripe.** Available to Stripe accounts in SE and most of the EEA,
  for SE customers only, through Payment Links and Checkout, with Connect. The
  docs show an access request form. **Stripe is the merchant of record for
  Swish** (factoring addendum), and Stripe's name appears as the recipient in
  the Swish app. No disputes, refunds up to 365 days, no manual capture. This is
  operationally simple, but the bookkeeping consequence of a factored
  receivable needs the accountant.

### 1.5 Others

- **Card-only Stripe Checkout.** The same adapter with `payment_method_types=['card']`.
  It covers USD stores and any customer without MobilePay, Vipps or Swish.
- **Shopify draft orders.** For stores already on the Shopify adapter:
  `draftOrderCreate` with the item's `K-<item id>` variant returns an
  `invoiceUrl` checkout. `reserveInventoryUntil` holds Shopify inventory. The
  paid order then arrives through the existing order pull
  (`lib/engine/shopify-orders.ts`) as provider `shopify`, with no new sale
  provider and no webhook. Shopify Payments offers MobilePay natively to
  customers in DK and FI (Shopify help centre, checked 2026-10-20). This is the
  cheapest path for Shopify stores and worth its own small follow-up. §7
  evaluates the store's own Shopify as a whole channel.
- **PayPal POS alternatives.** Not pursued. The issue starts from PayPal POS
  having removed links, and Komisio's PayPal POS integration
  (`extensions/zettle/`) has no link API to build on.

---

## 2. Flow

### 2.1 Roles and creation

- **Connect the provider:** owner or admin (as with Fortnox, Shopify and PayPal
  POS connections).
- **Create, cancel or resend a link:** owner, admin or staff, the same roles
  that may call `record_sale` (`20260916340000_shopify_automation.sql`,
  `record_sale_core`). `readonly` and `device` cannot.
- **Where:** the item page `app/(dashboard)/intake/items/[id]/page.tsx`, with a
  "send payment link" action, plus a multi-select from the items list for more
  than one item (at most 50 lines, the `valid_sale_lines` bound).
- **Input:** items (price = the current `item_prices` row at creation, frozen
  on the link; a later markdown does not change an open link), store currency
  (`komisio_private.store_currency`), optional note to the customer (bounded
  text, shown on Komisio's pay page, not sent to the provider), and fulfilment:
  `pickup` or `shipping` with a fee in the store currency.
- **Output:** a URL `https://<host>/pay/<token>` for the staff member to paste
  into the DM. Komisio sends nothing to the customer itself, so it needs no
  customer contact data.

### 2.2 Reservation (hold)

Proposal: the **link is the hold**. Two new append-only tables (migration):

- `payment_links`: id, tenant, token hash, provider, connection revision,
  currency, lines (item id + frozen price öre), fulfilment kind, shipping öre,
  note, `expires_at`, created by, created at. Immutable.
- `payment_link_events`: `opened` (provider session id), `authorized`,
  `recorded` (sale id), `captured`, `cancelled` (by whom), `expired`,
  `refused` (engine code), `voided` (authorization cancelled), `refunded`.
  Each is a new row. State is derived (rule 4: corrections are new rows).

An item is **held** while a link containing it is not yet recorded, cancelled
or expired, and `now() < expires_at`. If a provider session is still open
(`opened` without a final provider state), the hold lasts until that session's
provider expiry, so a customer in the middle of paying is never cut off.

- **Default expiry: 24 hours**, chosen by staff from 1 to 72 hours. This is a
  proposal for the owner: DMs are answered within a day, and a longer hold
  blocks the till.
- **Stage.** The hold does **not** become a new `itemStage` value. It is an
  orthogonal `reserved` flag (with the link id and expiry) on the overview and
  lifecycle reads, because a held item can still be `markdown_due` or
  `period_ending`. Adding a stage would change `itemStage` in
  `lib/engine/items.ts`, the stage check in `lifecycle_queue_page`
  (`20261019020000_lifecycle_table_page.sql`), filters and 8 locales. A flag
  only adds a badge, a filter and their strings. `sold` still comes from
  `komisio_private.item_lifecycle` as today.
- **Effect on other sales.** `komisio_private.sale_line_facts` (last defined
  in `20260914070000_lifecycle.sql`) gets one more refusal: `ITEM_RESERVED` for
  provider `manual` when another link holds the item. Staff cancel the link
  first, which is one click and leaves an audit row. PayPal POS and Shopify
  receipts are **not** refused: they are completed external payments. They
  record as today, and Komisio then cancels the link (see §3).
- **Migration:** yes (two tables, RLS, grants, the `sale_line_facts` change,
  pgTAP).

### 2.3 Paid

1. The customer opens `/pay/<token>`. Komisio checks the token (by hash), the
   hold and the connection, then creates a provider payment for the frozen
   amount with manual capture where the method supports it. It records
   `opened` with the provider id and redirects to the hosted page.
2. The provider's signed webhook arrives (`checkout.session.completed` with an
   uncaptured PaymentIntent for Stripe; `AUTHORIZED` for Vipps MobilePay).
3. Komisio calls the engine. A new private core function records the sale with
   `record_sale_core(p_tenant, <derived id>, 'payment_link', <provider payment
id>, <authorized at>, <currency>, <lines>, <reference>)`.
   - **New provider value** `payment_link` (one value for all link providers;
     the link row says which provider). This needs a migration: the
     `sales.provider` check in `20260914000000_sales.sql` (`manual`, `zettle`,
     `shopify`), the same list inside `record_sale_core`, and `saleProvider`
     in `lib/engine/sales.ts`. The UI label for the provider needs 8 locales.
   - `external_id` = the provider payment id (`pi_…` or the ePayment
     reference). The existing `(tenant, provider, external_id)` uniqueness makes
     webhook retries no-ops, and `SALE_CONFLICT` catches a mismatched replay.
   - `provider_reference` = `{ paymentLinkId, provider, account }` only. No
     buyer data.
   - **Actor.** `record_sale_core` requires an identity. The webhook has none,
     so it follows `docs/AUTOMATION-ACTOR.md`: an automation grant with a new
     scope (for example `payment_link_capture`) that opens exactly this core,
     like `zettle_pull` and `shopify_pull` do in `record_sale_core` today. This
     needs a migration.
4. If the engine accepted it: **capture**, then record `captured`. If the
   engine refused (`ITEM_ALREADY_SOLD`, `ITEM_ENDED`, `CURRENCY_MISMATCH`, …):
   **cancel the authorization** and record `refused` plus `voided`. No money
   moves, so nothing needs a refund. If capture fails after the sale is
   recorded: record a full return through `record_return` (reason
   `capture_failed`) and show it to staff.
5. Without manual capture (Swish), a refusal leads to an automatic provider
   refund plus a `refunded` event, shown to staff.

The item becomes `sold` through the existing `sold` item event. Seller credit
is frozen per line by `sale_line_facts` and booked as `credit_sale` in
`seller_ledger_entries`, so settlement (`docs/SETTLEMENT.md`) needs no change.
The sale appears in day close (`komisio_private.day_close_totals`) and the
accounting export (`voucher_for`, Fortnox `lib/engine/fortnox-vouchers.ts`,
e-conomic #523) like any other sale.

**Reconcile fallback.** A scheduled job (Vercel cron, same pattern as
`/api/automation/zettle-pull`) lists links with `opened` and no final state.
It retrieves the provider payment and feeds the same engine path. Missed
webhooks therefore converge, and duplicates converge on `external_id`.

**Clearing account (migration).** The voucher today has a single `grossOre`
key (`komisio_private.accounting_keys`, `20260914160000_accounting_export.sql`,
extended in `20261010140000_consignment_fee_accounting.sql`). Money from PayPal
POS, Shopify, the counter and a link all debit one account. Link money arrives
at Stripe or Vipps MobilePay, not at the till. Proposal: split gross per
channel in `day_close_totals` (`perProvider`) and add keys such as
`provider:payment_link:grossOre`. Each store maps them to its own clearing
account (in Sweden typically a 15xx receivable; no account is assumed, see
#523's "no Danish chart is assumed"). Provider fees are booked from the
provider's payout report, as they are for PayPal POS today. Komisio does not
book fees.

### 2.4 Customer receipt

- Stripe sends an e-mail receipt if the store enables it (the customer gives
  their e-mail on Stripe's page, and Komisio never sees it). Vipps MobilePay
  shows the payment in the app with the store name.
- Komisio's `/pay/<token>/done` page shows what was bought, the amount, the
  VAT amount and the store's name and VAT number from the store profile. If the
  accountant requires a seller-issued receipt, that page (printable) is it.
  This is a new UI surface and needs strings in 8 locales.
- **Cash register questions for the accountant** (Komisio does not decide;
  `skills/consignment-sweden/SKILL.md` "Cash register" and `docs/open-questions.md`
  item 13 delegate the cash register to the POS provider):
  - **SE:** Is a payment-link sale, agreed in a DM and paid remotely, a
    distance contract (distansavtal) and therefore outside the kassaregister
    requirement? A secondary source lists distance contracts as an exemption,
    and Skatteverket treats Swish like card payment. If the customer pays the
    link while standing in the shop, is it then a till sale that must go
    through the certified register?
  - **NO:** Does the kassasystemlova exemption for remote sales (fjernsalg)
    cover a link sent in a DM? Which receipt content is required?
  - **DK:** What do bogføringsloven and the receipt rules require for a remote
    MobilePay sale? Is the provider's record plus Komisio's receipt page
    enough?
  - **FI:** Is the obligation to provide a receipt on request met by the
    provider's record plus Komisio's receipt page?
  - **All:** Does the 14-day right of withdrawal for distance sales apply, and
    what must the store tell the buyer before payment? This affects the pay
    page text.

### 2.5 Expiry, cancel, failure

- **Expiry** at `expires_at` (and after any open provider session ends): the
  hold is released, and the reconcile job writes `expired`. The token stops
  working.
- **Cancel** by staff: Komisio first expires or cancels the provider session
  (Stripe `checkout/sessions/:id/expire`, Vipps MobilePay `cancel`). If the
  provider says the payment already completed, the cancel fails and the
  payment path wins. Otherwise Komisio records `cancelled` and releases the
  hold.
- **Failure** (customer aborts, payment declined): the provider session ends.
  The link stays usable until its expiry, so the customer can try again and a
  new session is created.
- **Payment after expiry:** with manual capture, an authorization arriving
  after the hold ended is recorded if the item is still available (the engine
  decides), otherwise voided. With Swish, it is recorded if available,
  otherwise refunded. Proposal: **accept when available**. The customer did
  what the store asked.

### 2.6 Refunds

Staff press "refund" on a link sale. Komisio calls the provider refund for the
full line amount, then `record_return` (`lib/engine/returns.ts`,
`20260914030000_sale_returns.sql`) with `refund = line price`. The return
reverses the seller credit, frees the item and flags the return if the credit
was already reserved or paid out, exactly as today. The order matters: provider
refund first, return after confirmation. A failed refund records no return.
Partial refunds stay out of scope (`PARTIAL_REFUND_UNSUPPORTED`). A shipping
refund follows the shipping line (§2.7).

### 2.7 VAT, including shipping

No VAT logic moves to the provider. The amount sent to the provider is the
tax-inclusive total of the frozen lines. Stripe Tax is **not** enabled on store
payments (#539 concerns Komisio's own billing only). VAT per line is what
`sale_line_facts` computes from the item's frozen ownership and terms and the
store policy at that moment (`docs/VAT-CASES.md`, `lib/engine/vat.ts`):

| Mode                   | Item line                                               | Seller credit | Note                   |
| ---------------------- | ------------------------------------------------------- | ------------- | ---------------------- |
| `consignment_margin`   | VAT on margin (price − seller credit)                   | Unchanged     | Same as a counter sale |
| `consignment_full`     | VAT on the whole price                                  | Unchanged     | —                      |
| `consignment_business` | VAT on the whole price; commission invoice VAT as today | Unchanged     | —                      |
| `store_margin`         | VAT on max(price − purchase price, 0)                   | n/a           | —                      |
| `store_full`           | VAT on the whole price                                  | n/a           | —                      |

The rate is the single `vatRatePercent` policy value (FI 25.5 % fits the
basis-point column). The Swedish skill is the only verified VAT source.
DK/FI/NO margin-scheme equivalence is **not verified**, and the store's
accountant decides the mode, as for any sale.

**Shipping.** `valid_sale_lines` accepts only item lines (`itemId`,
`priceOre`), so shipping cannot be a sale line today. Proposal:

- Shipping is **store revenue**. It never enters commission, seller credit or
  the item price.
- A new line kind `shipping` on the sale, or a `sale_charges` fact referencing
  the sale, recorded in the same transaction as the sale. Migration plus
  pgTAP.
- Its VAT treatment is a store policy choice, made with the accountant like
  `vatModeConsignmentPrivate`, with no default: `standard` (VAT at the policy
  rate on the fee) or `follow_principal` (shipping follows the goods' VAT
  treatment). Margin-scheme goods are the hard case. Whether the shipping fee
  joins the margin-scheme price is a question for the accountant. Until a store
  has chosen, links offer pickup only.
- Day close and voucher get `shipping:netOre` and `shipping:vatOre` keys
  (the same migration as the clearing split).
- A refund of a shipped line refunds shipping only if the whole sale is
  returned (proposal). Otherwise shipping stays.

Pickup only (no shipping) needs none of this. A first slice can be pickup only.

---

## 3. Relation to PayPal POS and Shopify sales

**Chosen prevention: both, with the engine as the guarantee.**

1. **Engine guarantee (already exists).** `sale_line_facts` refuses a second
   completed sale of an item (`ITEM_ALREADY_SOLD`), and record_sale_core takes
   the tenant row lock (`for update`), so two sales of one item serialize. With
   manual capture, the link side always loses cleanly (void, no refund) if it
   comes second.
2. **Hold in the catalogs (best effort).** While held, the item's PayPal POS
   stock is moved from STORE to another inventory and back on release.
   Shopify's `available` quantity goes to 0 and back. The exporters today can
   only initialize stock 0→1 (`extensions/zettle/inventory.ts`
   `initialize`/`mayInitialize`; Shopify product updates "never replenish
   existing inventory", `docs/SHOPIFY-ADAPTER.md`). A hold therefore needs new
   adapter writes and intent/outcome rows like the existing ones (migration).
   This is advisory: the PayPal POS pull runs every ten minutes, and
   `docs/SHOPIFY-ADAPTER.md` says Shopify inventory policy "alone is not a
   verified guarantee against overselling across disconnected tills". It is a
   separate, later follow-up.
3. **POS sale of a held item.** The receipt is recorded as today: completed
   money beats a promised payment. Komisio then cancels the link (provider
   expire or cancel). If the customer paid in the same window, the
   authorization is refused and voided (or refunded for Swish), and staff see
   one line explaining it.
4. **Link paid first, then a POS sale.** The PayPal POS receipt or Shopify
   order is held with `ITEM_ALREADY_SOLD`, as today. The staff recovery path
   follows (§3.1).

### 3.1 Staff recovery when both happened

Both payments really took place (for example, Swish was paid and the till sold
the item, or the till sold it before the hold reached the POS).

- The engine has recorded exactly one sale. The other is held: a PayPal POS
  receipt outcome or Shopify order outcome with `ITEM_ALREADY_SOLD`, or a link
  event `refused` with a voided authorization (nothing to do) or with a refund
  (Swish, automatic).
- For a held PayPal POS or Shopify receipt, staff refund that customer in the
  POS. The held receipt never became a sale, so no return is recorded. How the
  existing refund reconciliation shows a refund of an unrecorded receipt was
  not checked and belongs to slice 14.
- To keep the POS sale and refund the link instead: staff refund the link sale
  (§2.6). This records a return, which frees the item. Then they retry the
  held receipt (`reconcile_zettle_receipt` / `reconcile_shopify_order`), which
  now records.
- Counted once in all paths: day close counts only `completed` sales minus
  returns.

**A paid link is never also recorded from a PayPal POS receipt.** A link sale
has provider `payment_link` with the provider payment id. A POS receipt has
provider `zettle` or `shopify` with its own id. The link money never passes
through the POS, so no receipt exists for it. If staff also ring up the item at
the till "for the record", the engine refuses it as `ITEM_ALREADY_SOLD`. The
help text must say not to do that.

---

## 4. Security and privacy

- **Webhooks.** Verify the signature against the raw body before parsing,
  with the size bound used by `app/api/billing/webhook/route.ts`. Stripe:
  reuse `verifyStripeSignature` (`extensions/stripe/api.ts`: HMAC-SHA256,
  timing-safe compare, 300-second tolerance) with the Connect endpoint secret.
  Vipps MobilePay: a new verifier for its HMAC scheme, plus our own
  `x-ms-date` window (5 minutes) because none is documented. Replay: the event
  id is stored once (unique), and the money fact is idempotent by
  `(tenant, 'payment_link', external_id)`. The handler never trusts amounts
  from the event. It re-reads the provider payment by id with our credentials
  and compares the amount, currency and account with the frozen link.
- **Tenant binding.** The webhook resolves the tenant from the link (found by
  the provider id we stored), never from metadata alone. Stripe's
  `event.account` must equal the connected account bound to that tenant's
  connection revision.
- **No card or wallet data.** Hosted provider pages only. Komisio stores
  provider ids and statuses, never card numbers, wallet ids or phone numbers.
- **Buyer data.** None by default. Komisio does not ask for or store the
  buyer's name, e-mail or phone. The store knows the buyer from the DM. If
  shipping is offered, the address is collected by the store in the DM, or by
  the provider (Stripe `shipping_address_collection`, Vipps Express), and
  stays in the provider's account. Komisio does not copy it. With that rule,
  the privacy notice and DPA need only one sentence that payment links are
  processed by the store's chosen provider, which the store controls. If a
  later slice stores addresses, it needs a retention period (proposal: until
  the return window ends plus the accounting retention of the sale reference
  only), an erasure path like seller closure, and a DPA update. That decision
  belongs to the owner.
- **Credentials.** Stripe: no per-store secret. The platform key stays in the
  environment, and only `acct_…` is stored, bound by OAuth. Vipps MobilePay
  sales-unit keys: sealed with `seal()` in `lib/platform/credentials.ts`
  (AES-256-GCM, `KOMISIO_CREDENTIAL_KEY`), opened only server-side for a call,
  never returned to members, never logged. Error logs carry codes only.
- **Links.** The token is 32 random bytes (base64url), and only its SHA-256 is
  stored. It expires. The amount and currency are fixed server-side from the
  frozen link. The pay page accepts no amount, price or item input. Rate-limit
  token lookups. The pay page shows only the item title, price, store name and
  note, never seller data. Unknown or expired tokens return one generic page,
  with no difference between "never existed" and "expired".
- **Server flag.** The whole feature sits behind a server environment flag
  (default off) until pilot acceptance, like `SHOPIFY_ACCEPT_TEST_ORDERS`.

---

## 5. Recommendation and plan

### 5.1 Per market

| Market             | Recommendation                                                                                                                                                                                                                               | Trade-offs we accept                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DK**             | Stripe Connect, direct charges, MobilePay + card, manual capture                                                                                                                                                                             | Stripe fees are higher than Vipps MobilePay's own (1.49 % + 1 DKK for portal links), plus 35 DKK/month. Stores must open a Stripe account even if they already have MobilePay |
| **FI**             | Same, MobilePay in EUR + card                                                                                                                                                                                                                | As DK, without the monthly fee                                                                                                                                                |
| **NO**             | Stripe Connect with cards now. Vipps when it leaves Stripe's private preview, or the direct ePayment adapter (slice 9)                                                                                                                       | Norwegian customers expect Vipps. Card-only links are a weak first offer in NO                                                                                                |
| **SE**             | Card via Stripe Connect now. Swish follows the owner's decision: (a) Swish via Stripe if the accountant accepts Stripe as merchant of record, or (b) Swish Handel direct once the certificate question in `docs/SWISH-PAYOUTS.md` is settled | Swedish customers expect Swish. Card first is a weak offer, but there is no store request from SE yet                                                                         |
| **EUR elsewhere**  | Card via Stripe Connect. MobilePay shows for DK/FI customers                                                                                                                                                                                 | —                                                                                                                                                                             |
| **USD**            | Card via Stripe Connect                                                                                                                                                                                                                      | —                                                                                                                                                                             |
| **Shopify stores** | The store's own Shopify (§7): draft order + `invoiceUrl` through the existing adapter (slice 10), MobilePay native on Shopify Payments in DK/FI                                                                                              | Needs the de-list/sync work (slice 15) before it is safe next to a PayPal POS till. Swish only on Shopify Plus; Vipps only through an app                                     |

Why Stripe first: one adapter covers all five currencies (cards) and MobilePay
in DK/FI. It has manual capture, so a double sell is solved without refunds.
The store is merchant of record, and Komisio already has the Stripe signature
code and webhook pattern. Why not Vipps MobilePay direct first: every store
needs its own merchant agreement and keys (or Komisio a partner agreement),
there is no SE or USD coverage, and the 10-minute lifetime means the same
Komisio pay page anyway. Both share the provider-neutral core (slices 1–4), so
the order can flip if the Danish store prefers its existing MobilePay
agreement. That is a question for the owner.

### 5.2 Interim for the Danish store (no development)

The store creates a payment link per item in the Vipps MobilePay business
portal (1.49 % + 1 DKK, published) and pastes it into the DM. When paid, staff
record a counter sale in Komisio (provider `manual`). Known gaps: no hold (staff
must avoid selling the item at the till meanwhile), the voucher books that sale
to the same gross account as the till, and a portal link is reusable ("everyone
who clicks on the link can pay you"), so staff must deactivate it after
payment. This can start today.

### 5.3 Proposed follow-up issues (not created)

Rough effort in focused developer days, including pgTAP, unit tests and 8
locales where UI is involved.

1. **Reservation model (holds)** (3–4 d). `payment_links` and
   `payment_link_events` tables, the derived hold, a `reserved` flag on the
   items overview, lifecycle and item page, `ITEM_RESERVED` in `sale_line_facts`
   for manual sales, cancel, and the expiry job. Migration + pgTAP. No provider.
2. **New sale provider `payment_link`** (1–2 d). The `sales.provider` check,
   `record_sale_core` list, `saleProvider`, sale search filter and label, and a
   private core entry with automation scope `payment_link_capture`. Migration +
   pgTAP.
3. **Accounting split per channel and shipping keys** (2–3 d). `perProvider`
   gross in `day_close_totals`, new keys in `accounting_keys`/`voucher_for`,
   Fortnox and e-conomic mapping UI, and reconciliation. Migration + pgTAP.
   This also fixes the existing single gross account for PayPal POS vs.
   Shopify vs. counter.
4. **Public pay page and token** (2–3 d). `/pay/<token>`, the done/receipt
   page, rate limit, generic errors, buyer-facing strings in 8 locales, and
   withdrawal-right text once the accountant answers.
5. **Stripe Connect connection per store** (3–4 d). Embedded onboarding
   (Account onboarding component; Stripe-hosted Account Link as fallback; no
   OAuth, see §6.1) with prefill from the store profile, binding `acct_…` per
   tenant with a revision, a capability check (`mobilepay_payments` active),
   an "action needed" banner from `account.updated`, disconnect, and the
   Connect webhook endpoint and secret. Platform activation is owner/operator
   work.
6. **Stripe link adapter: session, webhook, capture, reconcile** (3–4 d).
   Checkout Session on open with manual capture, a signed Connect webhook,
   amount re-read, record → capture/void, the reconcile cron and test-mode e2e.
7. **Refunds for link sales** (1–2 d). Provider refund, then `record_return`,
   failure handling and the item page action.
8. **Link creation UI** (2–3 d). Item page action, multi-select, expiry
   choice, note, pickup/shipping, copy link, open links list with cancel.
9. **Vipps MobilePay ePayment adapter** (4–5 d). Sealed sales-unit keys or a
   partner model, ePayment create/capture/cancel/refund, the HMAC webhook
   verifier with a date window, a currency check against the sales-unit region,
   and reconcile.
10. **Shopify draft-order links** (2 d). `draftOrderCreate` with
    `reserveInventoryUntil`, return `invoiceUrl`, link it to the hold, and the
    paid order arrives through the existing pull.
11. **Shipping as store revenue** (2–3 d, after the accountant). Shipping
    line/charge fact, a `shippingVatMode` policy key with no default, day
    close and voucher keys. Migration + pgTAP.
12. **PayPal POS / Shopify stock hold** (3 d). Stock decrement and restore
    for held items, with intent/outcome rows. Best effort, after 1–8.
13. **Swish** (2 d via Stripe, or 5+ d direct). After the owner's decision.
14. **Help and docs** (1 d). A help page for links, recovery steps (§3.1),
    "do not ring up a link sale at the till", and the integration doc.
15. **Shopify as a remote-sales channel: selection and de-list sync**
    (4–5 d). A per-item "show online" choice, automatic Shopify export under
    `catalog_export`, setting inventory to 0 (or unpublishing) when an item
    sells elsewhere, ends or is held, an audited restock after a return, and
    optionally a signed `orders/paid` webhook to shorten the 15-minute pull.
    Migration + pgTAP. Needed before §7 is safe next to a PayPal POS till.
16. **Company number and legal name in the store profile** (1 d). Prefills
    Stripe (and Vipps MobilePay) onboarding (§6.1). Migration (profile schema)
    - 8 locales.

The minimum useful pilot for the Danish store is slices 1, 2, 4, 5, 6, 7 and 8
with pickup only, **about 15–22 days**. Slice 3 should land before a store
exports vouchers with link sales.

### 5.4 Open questions for the owner or an accountant

1. **Owner:** Stripe Connect first, or Vipps MobilePay direct first because the
   Danish store already has MobilePay? Does Inority accept becoming a Stripe
   Connect platform (terms, platform profile)?
2. **Owner:** Default hold of 24 hours (1–72 selectable)? Accept a payment that
   arrives after expiry when the item is still available?
3. **Owner:** Should a POS sale of a held item win and cancel the link (the
   proposal), or should the hold refuse the POS receipt?
4. **Owner/accountant (SE):** Swish via Stripe with Stripe as merchant of
   record (factoring): acceptable for bookkeeping and for the customer seeing
   Stripe as recipient? Otherwise, the certificate route in
   `docs/SWISH-PAYOUTS.md` question 1 decides Swish Handel.
5. **Accountant, per market:** the cash-register and receipt questions in
   §2.4, and the withdrawal-right text.
6. **Accountant:** shipping VAT for margin-scheme goods (`follow_principal`
   vs. `standard`). Is shipping revenue ever part of the margin?
7. **Accountant:** which clearing account per store and channel. Provider
   fees booked from payout reports (as for PayPal POS)?
8. **Owner:** does Komisio ever store buyer shipping addresses, or always
   leave them in the DM or the provider? This decides the DPA change.
9. **Stripe (support):** is the MobilePay fee additive to the card fee (note 1)?
   Will connected accounts registered in NO get Vipps after the preview? Is
   the 35 DKK MobilePay monthly fee per account or per company?
10. **Owner:** offer the store's own Shopify (§7) as a parallel route, and in
    which order relative to Stripe payment links (slice 15 vs. slices 5–6)?
11. **Owner:** if Vipps MobilePay direct is ever wanted, apply to its partner
    program first (§6.2)?

### 5.5 Observed outside the scope

- `day_close_totals` uses a fixed `Europe/Stockholm` day boundary
  (`20260914050000_day_closes.sql`, `20261010140000_consignment_fee_accounting.sql`).
  For FI stores (UTC+2/+3), the local day is shifted by one hour. Payment links
  make late-evening remote sales more likely, so this deserves its own issue.

---

## 6. Store onboarding, from the store's point of view

Owner request on #552. Sources checked 2026-10-20 (see [References](#references)).
Times are **assumptions** unless stated: no provider publishes a review time we
could rely on, and we created no accounts to measure one.

### 6.1 Recommended: Stripe Connect, direct charges, Stripe liable for losses

The configuration is a connected account with the full Stripe Dashboard,
`controller.requirement_collection = stripe`, `controller.losses.payments = stripe`
and `controller.fees.payer = account` ("Stripe handles pricing"). Stripe
collects KYC and carries negative balances. Komisio never sees ID documents or
bank details.

| #   | Step                                                                           | Where                                                                                                                                 | What the store provides                                                                                                                                                                   | Time (assumed)                                |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Owner or admin presses "Connect payments" on Komisio's integrations page       | Komisio                                                                                                                               | Choice of country (prefilled from the store)                                                                                                                                              | < 1 min                                       |
| 2   | Komisio creates the connected account with prefilled data and opens onboarding | Embedded in Komisio (Account onboarding component), or a Stripe-hosted page (Account Link)                                            | —                                                                                                                                                                                         | —                                             |
| 3   | Sign in to Stripe, or create a Stripe login                                    | Stripe pop-up inside the embedded component (Stripe user authentication is on by default; full-Dashboard accounts cannot turn it off) | E-mail, phone for SMS codes                                                                                                                                                               | 2 min                                         |
| 4   | Business details                                                               | Stripe form                                                                                                                           | Company name, company registration number (DK: CVR, the `dk_cvr` id), address, phone, website or product description, MCC (prefilled), support phone                                      | 3–5 min                                       |
| 5   | Representative                                                                 | Stripe form                                                                                                                           | Name, date of birth, home address, e-mail, phone, job title, nationality. Stripe may ask for an ID document or selfie if registry checks fail (`supports_stripe_identity`)                | 3–5 min (+5 min if an ID upload is asked for) |
| 6   | Owners and directors                                                           | Stripe form                                                                                                                           | Each beneficial owner and director: name, date of birth, address, e-mail. Attestation "owners provided". Possibly proof of registration or beneficial ownership documents as alternatives | 2–5 min                                       |
| 7   | Payout account                                                                 | Stripe form                                                                                                                           | Bank account (IBAN) in the company's name                                                                                                                                                 | 1 min                                         |
| 8   | Accept Stripe's service agreement                                              | Last screen of the form                                                                                                               | —                                                                                                                                                                                         | < 1 min                                       |
| 9   | Verification                                                                   | Stripe, in the background                                                                                                             | Nothing, unless Stripe asks again                                                                                                                                                         | Minutes to a few business days                |
| 10  | MobilePay capability becomes `active`                                          | Stripe; Komisio shows the status                                                                                                      | Nothing (Komisio requests `mobilepay_payments` at creation)                                                                                                                               | Unknown; not documented                       |
| 11  | First link: staff send a link from the item page; the customer pays            | Komisio, then Stripe Checkout                                                                                                         | —                                                                                                                                                                                         | —                                             |

The requirement list above is Stripe's own list for an SE platform and a DK
company with card payments, transfers and MobilePay (Stripe's
"required verification information" endpoint, queried 2026-10-20). Stripe uses
no MitID or BankID; identity is checked against registries, with an ID document
or selfie as fallback. **Realistic total: 15–25 minutes of the store's time**
when the person onboarding has the owners' details at hand. Activation follows
Stripe's review. Payouts can be held until verification completes, so the
first link can go out before money reaches the bank.

**Already has a Stripe account.** The account itself cannot be reused as is.
OAuth to connect an existing account is "not recommended for new Connect
platforms", and since June 2021 a `read_write` platform cannot connect a
Standard account that another platform controls. The store gets a new
connected account under Komisio's platform instead. Networked onboarding is on
by default: when the store signs in with the same Stripe user, it can reuse the
verified legal entity. Company and person data are then copied and kept in
sync; bank account, business profile and branding are copied once. This needs
`requirement_collection = stripe` and authenticated onboarding, which is the
recommended configuration. The new account has its own balance and payouts,
and MobilePay must be enabled on it. Whether the 35 DKK MobilePay monthly fee
is charged per Stripe account or per company was **not verified**.

**Already has a MobilePay agreement.** It is not reused by Stripe. Stripe's
MobilePay runs on Stripe's own acquiring (Stripe "performs a card transaction
using the card data we receive from MobilePay"). The store's own Vipps
MobilePay agreement stays separate and is not needed for Stripe (assumed from
the docs; not confirmed with Stripe).

**What Komisio can prefill or remove.**

| Can prefill                     | Source in Komisio                                                              | Note                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Country                         | Store currency and signup country                                              | Prefilling the country fixes it, and networked onboarding then only offers legal entities from that country |
| Business type `company`         | —                                                                              | Komisio stores are companies (assumed)                                                                      |
| E-mail, phone, address, website | Store profile (`docs/STORE-PROFILE.md`: address, e-mail, phone, https website) | The store confirms or edits before accepting the agreement                                                  |
| Product description             | Fixed text, e.g. "Second-hand consignment store"                               | Used when the store has no website                                                                          |
| MCC                             | 5931 (used merchandise and second-hand stores, assumed to fit)                 | The store can change it                                                                                     |
| Capabilities                    | `card_payments`, `transfers`, `mobilepay_payments`                             | Requesting only what is needed shortens the form                                                            |
| Branding                        | Store name and logo, if held                                                   | Shown on Checkout and in the MobilePay app                                                                  |

What cannot be removed: the Stripe sign-in, representative identity, owners
and directors, the bank account, and acceptance of the agreement. Komisio holds
**no company registration number or legal company name** in its schema (none
found in `supabase/migrations`; assumed not held), so the store types these.
A later profile field could prefill them. API-only onboarding (Accounts v2)
would let Komisio build the whole form itself. Stripe advises against it
("requires integration changes" when rules change), and it rules out networked
onboarding, so it is rejected.

**What can block or delay activation, and how the store sees it.**

- Verification asks for more (`requirements.currently_due`, `past_due`).
  Komisio listens to `account.updated` and shows "Stripe needs more
  information" with a button that reopens the same onboarding component.
  Stripe's component knows which fields are missing.
- Restricted business checks on the MCC or website. They show in the same
  requirements. Second-hand clothing is not on Stripe's MobilePay or Swish
  prohibited lists (pawn shops, MCC 5933, are prohibited for Swish).
- The MobilePay capability stays `pending` or becomes `inactive`. Komisio
  offers card-only links meanwhile and shows the capability state.
- Payouts are paused until the bank account is verified. Links still work;
  the money waits on the store's Stripe balance.

### 6.2 For comparison: Vipps MobilePay ePayment direct

| #   | Step                                             | Where                                                                                                                                                                                                         | What the store provides                                                                                                              | Time (assumed)                          |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | Merchant Agreement, if the store has none        | Vipps MobilePay business portal, signed with BankID (NO) or MitID (DK) by someone with signing rights                                                                                                         | Company number, signatory, KYC questions, beneficial owners (assumed; not listed on the partner pages)                               | 15–30 min                               |
| 2   | Product order for "payment integration" (online) | Business portal. Prefilled from a Komisio link if Komisio is a partner with API keys (`POST /management/v1/product-orders` returns a `prefillUrl`, valid 14 days); otherwise a template link or a manual form | Sales-unit name, website (the company number must be visible on it), MCC, settlement bank account, price package, use case, turnover | 10 min                                  |
| 3   | Review by Vipps MobilePay                        | Vipps MobilePay                                                                                                                                                                                               | Nothing; corrections by e-mail if incomplete                                                                                         | "May take a few days" (Vipps MobilePay) |
| 4   | Connect to Komisio                               | Partner model: automatic once the sales unit is approved (Komisio receives the merchant serial number). Without the partner model: the store copies four API keys from the portal into Komisio                | Keys (non-partner model only)                                                                                                        | 5–10 min                                |
| 5   | Long-living payments, if wanted                  | Request to Vipps MobilePay                                                                                                                                                                                    | Justification. DK on request, FI only for former MobilePay Invoice merchants, NO at most 24 h                                        | Unknown                                 |
| 6   | First link                                       | Komisio pay page creates a 10-minute ePayment when opened                                                                                                                                                     | —                                                                                                                                    | —                                       |

**Realistic total:** 30–60 minutes of the store's time, plus a review of a few
days. The Management API runs only in production and partner keys work only
in production, so Komisio cannot rehearse onboarding in a test environment.

**Already has a MobilePay agreement** (as the Danish store does): step 1 is
skipped, but the store still needs a product order for the online
payment-integration product, unless it already has one. A MobilePay Box or
portal payment-links product is a different product. Vipps MobilePay
documents a separate "change a merchant's partner" path for a sales unit
already run by another integrator.

**What Komisio can prefill:** company number, sales-unit name and logo,
website, MCC, settlement account (if the store gives it to Komisio), and price
package (locked; only the partner can change it). This needs Komisio to be an
approved Vipps MobilePay partner with partner keys. Rejection reasons are not
shared with partners, so Komisio can only tell the store to check its portal
and e-mail.

**What can block it:** an incomplete product order, a website that does not
show the company number or meet the "regional regulatory terms", the review
queue, and a signatory without signing rights. Without partner keys, the store
must copy keys correctly. Copied keys also give anyone who sees them full
access to that sales unit, which Vipps MobilePay itself warns about.

### 6.3 Conclusion on plug-and-play

- **Stripe Connect** comes close to plug-and-play: one embedded form inside
  Komisio, about 15–25 minutes, no keys to copy, and nothing to rehearse
  outside test mode. The parts Komisio cannot remove are legal KYC (people,
  owners, bank account). Komisio can cut a few minutes by adding a company
  number and legal-name field to the store profile.
- **Vipps MobilePay direct** is not plug-and-play without a partner agreement
  (the store copies four keys). With one, it is "fill in a prefilled order and
  wait a few days". It suits stores that already have a Merchant Agreement,
  but still needs a product order and review.
- **The recommendation stands.** Onboarding effort strengthens Stripe as the
  first provider. If the owner later wants Vipps MobilePay direct, apply for
  the partner program first. Without it, the onboarding is the weakest part of
  that option.

## 7. The store's own Shopify as the remote-sales channel

Owner request on #552. Sources checked 2026-10-20. The store runs its own
Shopify store, chooses which Komisio items to publish there, posts a product
or checkout link on Instagram, and the buyer pays in Shopify Checkout. The
paid order comes back into Komisio as an ordinary sale through the existing
Shopify adapter.

### 7.1 Payments per market

| Market | Shopify Payments (native)                                                             | Through an app                                                                                                 |
| ------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DK     | Cards, Apple Pay, Google Pay, Shop Pay, Klarna, **MobilePay** (customers in DK or FI) | Vipps MobilePay's own Shopify app (MobilePay DK/FI, Vipps NO); Nexi Checkout MobilePay; QuickPay (not checked) |
| FI     | As DK; MobilePay in DKK, EUR, NOK or SEK                                              | As DK                                                                                                          |
| NO     | Cards, wallets, Klarna; MobilePay for DK/FI customers. **Vipps not listed**           | Vipps MobilePay's Shopify app                                                                                  |
| SE     | Cards, wallets, Klarna, MobilePay for DK/FI customers. **Swish only on Shopify Plus** | Swish apps exist (not checked)                                                                                 |

Published fees (Shopify pricing page, rendered in SEK for our location;
DKK/NOK/EUR prices were not shown to us):

| Plan     | Monthly (annual / monthly billing) | Online card rate (Shopify Payments) | Fee for a third-party payment provider |
| -------- | ---------------------------------- | ----------------------------------- | -------------------------------------- |
| Basic    | 269 / 359 SEK                      | 1.6 % + 1.85 SEK                    | 2 %                                    |
| Grow     | 729 / 970 SEK                      | 1.5 % + 1.85 SEK                    | 1 %                                    |
| Advanced | 3,180 / 4,240 SEK                  | 1.4 % + 1.85 SEK                    | 0.6 %                                  |
| Plus     | from €2,100                        | 1.3 % + 1.85 SEK                    | 0.2 %                                  |

The help pages list no separate fee for MobilePay on Shopify Payments; we
assume the card rate applies (**not verified**). Vipps through an app costs the
Vipps MobilePay fee (§1.1) **plus** Shopify's third-party fee (2 % on Basic).

### 7.2 Store cost and effort

- **Cheapest suitable plan: Basic** (269 SEK/month with annual billing). The
  Starter plan (product links for social selling) "isn't available to new
  stores" according to Shopify's help centre. Only stores already on it keep
  it. It also lacks collections, staff accounts and POS Pro.
- **Store setup (assumed times):** create the shop and choose a plan (15 min);
  activate Shopify Payments, which is its own KYC with company, representative
  and bank details, similar to §6.1 (15–25 min plus review); turn on MobilePay
  under local payment methods; set shipping zones and rates, returns policy,
  terms and the legal pages a web shop needs (1–3 hours); connect the shop in
  Komisio and choose location and publications (`docs/SHOPIFY-ADAPTER.md`
  "Online store and Shopify POS"; 10 min). Optional: the Facebook & Instagram
  channel for product tags, which brings Meta's own commerce review.
- **Against Stripe Connect (§6):** Shopify needs the same KYC (inside Shopify
  Payments) **plus** a running shop: a monthly fee, shipping, terms and pages
  to maintain. Stripe needs only the KYC form and costs nothing per month (apart
  from the 35 DKK MobilePay fee in DK). For a store that wants only "pay for
  this item in a DM", Shopify is the heavier setup. For a store that wants a
  web shop anyway, the extra work buys a full channel.

### 7.3 Buyer experience

| Link type                                           | What the buyer does after tapping the link in Instagram                                      | Steps to paid                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Product page (online store)                         | Sees the page, taps "buy", checkout, chooses shipping/pickup, pays with MobilePay            | ~4: page → cart/checkout → delivery → pay                                  |
| Cart permalink to checkout (`/cart/<variant id>:1`) | Lands directly in checkout with the item, chooses delivery, pays                             | ~3. Reusable: every buyer gets a new checkout, so it is no reservation     |
| Draft order invoice (`invoiceUrl`)                  | Opens a checkout made for this buyer, possibly with shipping and price already set, and pays | ~2–3. Staff create it per buyer; `reserveInventoryUntil` can hold the unit |
| Instagram product tag (Shopping)                    | Taps the tag, product page in Instagram's browser, then as product page                      | ~4–5. Needs the Meta channel and approval                                  |

All of these use Shopify's checkout, so delivery address, shipping rates,
receipts and the buyer's e-mail are handled by Shopify, not Komisio. That is a
privacy plus for Komisio, but the store needs Shopify's privacy setup.

### 7.4 Fit with Komisio's code

What exists (`docs/SHOPIFY-ADAPTER.md`, `lib/engine/shopify-products.ts`,
`lib/engine/shopify-orders.ts`):

- **Products out:** one product with one variant per item, sku `K-<item id>`,
  one tracked unit, `inventoryPolicy: DENY`, publication to the chosen
  channels, price updates on markdown, one photo. Export is a **manual action
  per item by owner or admin** (`prepare_shopify_product`). The candidate list
  (`shopify_product_candidates`, last in
  `20261013230100_pos_catalog_receipts.sql`) shows up to 20 unsold, not-ended
  items without a current synced export. Items imported from the shop's own
  catalog are source-managed (`POS_SOURCE_MANAGED`).
- **Orders in:** paid, partially refunded and refunded orders pulled every 15
  minutes (`shopify_pull` scope), matched by sku, recorded through
  `record_sale_core` with provider `shopify`; refusals such as
  `ITEM_ALREADY_SOLD` are held for staff and retried with
  `reconcile_shopify_order`. Shopify refunds become returns.
- **Currency:** the connection refuses a shop currency other than the store's.

What is missing:

| Gap                              | Today                                                                                                                                                                   | Needed                                                                                                                                                                                                                                    | Migration                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Choose which items go to Shopify | One-by-one manual export; no automatic Shopify export ("no Shopify automatic-export control is offered before its adapter is implemented", `docs/ZETTLE-AUTOMATION.md`) | A per-item "show online" choice, or a rule (category, price), plus automatic export under `catalog_export`                                                                                                                                | Yes: a selection fact per item, and the Shopify adapter in the catalog-automation contract |
| Price and status in sync         | Price updates on markdown; sold and ended items are no longer candidates                                                                                                | When an item **sells at the till, ends or is returned to the seller**, set Shopify inventory to 0 or unpublish or archive the product. Nothing does this today; the adapter "never unpublishes" and has no inventory write after creation | Yes: intent/outcome rows for the de-list write                                             |
| Hold while reserved              | None                                                                                                                                                                    | Inventory 0 (or draft-order `reserveInventoryUntil`) while a Komisio hold exists (§2.2)                                                                                                                                                   | Yes, with slice 1                                                                          |
| Back in stock after a return     | Updates "never replenish" inventory                                                                                                                                     | A deliberate, audited restock after a return of a Shopify-sold or till-sold item                                                                                                                                                          | Yes                                                                                        |
| Double-sell window               | Shopify blocks a second online sale (one unit, DENY). The till does not know about it until the 15-minute pull; PayPal POS learns nothing                               | De-list on till sale (above) narrows the window. A Shopify `orders/paid` webhook would cut the pull latency                                                                                                                               | Webhook evidence table: yes                                                                |
| Recovery                         | `ITEM_ALREADY_SOLD` is held and visible; staff refund in Shopify; the refund becomes a return only if a Komisio sale exists                                             | The same staff path as §3.1                                                                                                                                                                                                               | No                                                                                         |
| Shipping                         | Order totals include shipping; Komisio records item lines only                                                                                                          | Same shipping question as §2.7: record Shopify shipping as store revenue                                                                                                                                                                  | Yes (slice 11)                                                                             |
| Day close                        | Shopify sales go to the single `grossOre` key                                                                                                                           | The channel split in slice 3                                                                                                                                                                                                              | Yes (slice 3)                                                                              |

What already works: the paid order becomes a normal Komisio sale with frozen
commission, seller credit and VAT. VAT stays in Komisio; Shopify's tax setting
must not change the price (prices tax-inclusive). This is **assumed** and must
be checked in a development shop, as `docs/SHOPIFY-ADAPTER.md` already notes
for POS.

### 7.5 Central marketplace variant (rejected)

One Komisio-operated Shopify store selling every store's items is **not
recommended** (assumptions to confirm, not legal advice):

- **Merchant of record and funds.** The buyer would pay Komisio (Inority),
  which would then pass the money on to each store. Collecting and forwarding
  funds for others is likely a payment service under PSD2 and the Nordic
  payment acts, unless a narrow exemption such as the commercial-agent
  exemption applies. Shopify's payment terms bar processing "on behalf of any
  affiliate or other third party".
- **Liability.** Komisio would be the seller to consumers: VAT on the sales
  (and the margin-scheme position of each store's goods would not carry over
  automatically), consumer and withdrawal rights, returns, disputes and
  chargebacks.
- **Bookkeeping.** Every sale would be Inority's revenue and a liability to a
  store, which turns Komisio's "sales are the store's facts" model upside down.

### 7.6 Conclusion

- **Prefer the store's own Shopify** when the store already runs Shopify, or
  wants a web shop anyway. It then gets MobilePay natively (DK/FI) without
  Stripe, shipping and receipts handled by Shopify, and an order path that
  already exists in Komisio. The draft-order invoice (slice 10) is the closest
  match to a "pay for this item" link, and it can hold the unit.
- **Prefer the Komisio payment link** for stores that only want to answer DMs:
  no monthly fee, no web shop to maintain, and the Komisio hold and manual
  capture give stronger double-sell protection than a 15-minute order pull.
- **Offer both. The recommendation does not change.** Stripe Connect payment
  links stay first for remote sales. Shopify becomes a parallel route that needs
  the de-list/sync work (new follow-up slice 15) before it is safe next to a
  PayPal POS till.

---

## Prototype: not built

The acceptance criteria make a prototype optional. It was not built because
the risky parts are the hold and engine changes, which need a migration (not
allowed here), and the provider sandbox, which needs a Stripe test-mode Connect
platform and test connected accounts, or Vipps MobilePay test sales-unit keys.
Creating those is creating provider accounts, which is out of scope. The
existing billing test mode cannot exercise Connect direct charges. Slice 6
includes the test-mode end-to-end check.

## Verified vs. assumed

**Verified in the repository (origin/main `ab209a7a`, 2026-10-20):**

- the `sales.provider` check and the provider list in `record_sale_core` (last
  definition in `20260916340000_shopify_automation.sql`), and `saleProvider`
  in `lib/engine/sales.ts`;
- `valid_sale_lines` accepts item lines only (no shipping);
- `ITEM_ALREADY_SOLD` and `ITEM_ENDED` in `sale_line_facts`, the tenant row
  lock in `record_sale_core`, and that the core requires an identity and
  admits only the `zettle_pull` and `shopify_pull` automation scopes;
- `itemStage` values and the stage check in `lifecycle_queue_page`;
- `record_return` is full refund only and frees the item;
- one `grossOre` voucher key with no channel split; the fixed Stockholm day
  boundary;
- PayPal POS inventory adapter initializes stock 0→1 only; Shopify updates do
  not replenish inventory;
- `verifyStripeSignature` behaviour and the billing webhook pattern;
  `seal`/`open` in `lib/platform/credentials.ts`;
- Shopify export is a manual per-item owner/admin action, candidates exclude
  sold and ended items, and no adapter write unpublishes, archives or zeroes a
  Shopify product (`extensions/shopify/`, `prepare_shopify_product`,
  `shopify_product_candidates`);
- the store profile holds address, e-mail, phone and website; no company
  registration number or legal name was found in the migrations.

**Verified on provider pages (2026-10-20):** all fees in §1.1 except those
marked third-party; Stripe MobilePay, Swish and Vipps properties; Payment
Links with Connect; direct-charge behaviour; Checkout Session expiry limits
(Stripe API reference via search result); Vipps MobilePay currencies per
region, the 10-minute default, long-living payment restrictions, partner keys,
the webhook HMAC scheme and portal payment links. For §6–7: Stripe onboarding
options, embedded onboarding (prefill, user authentication, requirement
updates), networked onboarding eligibility, OAuth status, the requirement list
for an SE platform and a DK company; Vipps MobilePay merchant signup, prefilled
product orders and Management API; Shopify Payments availability and local
payment methods in DK, FI, NO and SE; Shopify plan prices and rates (SEK
rendering); the Starter plan restriction; cart permalinks.

**Assumed or not verified:**

- whether Stripe's MobilePay fee is additive to the card fee (note 1);
- Vipps MobilePay DK integration price (the page layout was not legible),
  settlement timing and dispute handling;
- Swish Handel prices (a third-party figure), the Commerce API's 3-minute
  window, callback authentication and refund API (Swish developer docs did not
  render for our tools);
- Stripe Connect platform obligations and cross-border connected accounts for
  an SE platform;
- all legal statements in §2.4 and §7.5 and the shipping-VAT question: these
  are questions, not answers;
- MCC classification of second-hand clothing stores (5931 assumed);
- all onboarding and review times in §6 and §7.2; MobilePay capability
  activation time on Stripe; whether the 35 DKK fee is per account;
- that Stripe's MobilePay does not use the store's own MobilePay agreement;
- Vipps MobilePay Merchant Agreement content (KYC questions, owners) and MitID
  signing in DK (the docs name BankID);
- MobilePay fee on Shopify Payments (assumed equal to the card rate); Shopify
  prices in DKK, NOK and EUR; the Vipps MobilePay Shopify app's price; Swish
  apps; whether Shopify's tax settings leave Komisio's tax-inclusive prices
  untouched.

## References

All checked 2026-10-20.

- Stripe, local payment methods pricing (DK): https://stripe.com/en-dk/pricing/local-payment-methods
- Stripe, local payment methods pricing (SE): https://stripe.com/en-se/pricing/local-payment-methods
- Stripe, pricing (DK): https://stripe.com/en-dk/pricing
- Stripe, pricing (SE): https://stripe.com/en-se/pricing
- Stripe, Connect pricing (SE): https://stripe.com/en-se/connect/pricing
- Stripe, MobilePay payments: https://docs.stripe.com/payments/mobilepay
- Stripe, Swish payments: https://docs.stripe.com/payments/swish
- Stripe, Vipps payments (private preview): https://docs.stripe.com/payments/vipps
- Stripe, Payment Links with Connect: https://docs.stripe.com/connect/payment-links
- Stripe, direct charges: https://docs.stripe.com/connect/direct-charges
- Stripe, managing limited inventory with Checkout (`expires_at`): https://docs.stripe.com/payments/checkout/managing-limited-inventory
- Vipps MobilePay, pricing DK: https://vippsmobilepay.com/en-DK/pricing
- Vipps MobilePay, pricing NO: https://vippsmobilepay.com/en-NO/pricing
- Vipps MobilePay, pricing FI: https://vippsmobilepay.com/en-FI/pricing
- Vipps MobilePay, ePayment API: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/
- Vipps MobilePay, ePayment concepts (states, 10-minute default): https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/concepts/
- Vipps MobilePay, online flow: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/features/online/
- Vipps MobilePay, long-living payments: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/features/long-living-payments/
- Vipps MobilePay, across borders (currencies): https://developer.vippsmobilepay.com/docs/knowledge-base/across-borders/
- Vipps MobilePay, webhook request authentication: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication/
- Vipps MobilePay, partner keys: https://developer.vippsmobilepay.com/docs/partner/partner-keys/
- Vipps MobilePay, portal payment links: https://developer.vippsmobilepay.com/docs/knowledge-base/payment-links/
- Danske Bank, Swish Handel terms (SEK only, certificate upkeep): https://danskebank.se/-/media/files/se/pdf/foretag/priser-och-villkor/terms-for-swish-handel.pdf
- Nets Netaxept, Swish technical supplier (third party): https://developer.nexigroup.com/netaxept/en-EU/docs/swish/
- Checkout.com, Swish 3-minute expiry (third party): https://www.checkout.com/docs/payments/add-payment-methods/swish/api-only
- Realtid, Swish business fees (third party): https://www.realtid.se/bors-finans/3-miljoner-anvandare-bland-privatpersoner-endast-25000-foretag/
- Skatteverket, cash register: https://www.skatteverket.se/kassaregister
- Shopify, DraftOrder object (`reserveInventoryUntil`, `invoiceUrl`): https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder
- Stripe, choose your onboarding configuration: https://docs.stripe.com/connect/onboarding
- Stripe, embedded onboarding: https://docs.stripe.com/connect/embedded-onboarding
- Stripe, networked onboarding: https://docs.stripe.com/connect/networked-onboarding
- Stripe, OAuth with Standard accounts: https://docs.stripe.com/connect/oauth-standard-accounts
- Stripe, required verification information (SE platform, DK company, card_payments + transfers + mobilepay_payments): https://docs.stripe.com/_endpoint/get-requirements-for-setups?account-setup-A[apiVersion]=v1&account-setup-A[platformCountry]=SE&account-setup-A[accountCountry]=DK&account-setup-A[dashboardType]=full&account-setup-A[tosType]=full&account-setup-A[legalEntityType]=company&account-setup-A[capabilities][0]=card_payments&account-setup-A[capabilities][1]=transfers&account-setup-A[capabilities][2]=mobilepay_payments
- Vipps MobilePay, merchant signup for partners: https://developer.vippsmobilepay.com/docs/partner/merchant-signup/
- Vipps MobilePay, Management API guide (prefilled product orders): https://developer.vippsmobilepay.com/docs/APIs/management-api/management-api-guide/
- Vipps MobilePay, Shopify plugin: https://developer.vippsmobilepay.com/docs/plugins/shopify/
- Shopify, pricing (SE): https://www.shopify.com/se/pricing
- Shopify, Starter plan: https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-starter-plan
- Shopify Payments, supported countries: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries
- Shopify Payments, payment methods DK: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/denmark/payment-methods
- Shopify Payments, payment methods FI: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/finland/payment-methods
- Shopify Payments, payment methods NO: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/norway/payment-methods
- Shopify Payments, payment methods SE: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/sweden/payment-methods
- Shopify, cart permalinks: https://help.shopify.com/en/manual/checkout-settings/cart-permalink
- Shopify, Payment Facilitator terms: https://www.shopify.com/legal/terms-payfac
