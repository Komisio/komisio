# Stripe Tax for hosted billing

All subscription and AI credit-pack prices exclude VAT. The published amounts
are unchanged; see [PRICING.md](PRICING.md). Komisio requests automatic tax only
when the server variable `KOMISIO_STRIPE_AUTOMATIC_TAX` equals `true` exactly.
Unset, empty, `false` and all other values leave it off. Code deployment does
not activate tax. This setting concerns Komisio's hosted billing, not store sales,
commission, margin VAT or POS tax mapping.

Stripe determines amounts from customer billing information, product tax codes
and configured registrations. Komisio never selects a tax rate. Store country
still selects credit-pack currency only; the app language selects Checkout
language only. An optional VAT ID does not itself prove reverse charge.

## Operator checklist

Perform these actions in Stripe's dashboard, first in test mode. Application code
does not create prices, registrations or tax settings.

1. Set the business origin/head-office address in Sweden.
2. Enable Stripe Tax and choose **exclusive** as the default tax behavior.
3. Add the Swedish VAT registration. Add foreign registrations only when the
   operating company actually holds them.
4. Review the product tax code for subscription and credit-pack products.
   The issue's approved category is SaaS business use; Stripe currently lists
   `txcd_10103001` for that category. Recheck the current
   [tax-code catalogue](https://docs.stripe.com/tax/tax-codes) when configuring it,
   including whether the separate AI service category applies to credit packs.
   Classification remains an operator decision; the integration sets no code.
5. Set every configured Price explicitly to `tax_behavior=exclusive`, including
   all five credit currencies. Komisio refuses `inclusive` or `unspecified` when
   the flag is on, even if an account default might otherwise resolve it.
   Stripe does not allow changing an already explicit price tax behavior:
   create a replacement Price when necessary and update its environment setting.
   See [Stripe's price guidance](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior).
6. Configure invoices to display the operating company's VAT number and the
   customer's VAT ID and reverse-charge wording when applicable. Enable receipt
   and invoice emails for one-time payments. Permit billing-address and VAT-ID
   updates in the customer portal.
7. Configure test keys and exclusive test prices on staging. Enable the flag
   there and exercise both a subscription and a credit pack for each case below.
   Verify the tax before payment, invoice and email, then the recorded event.

| Billing details | Verification |
| --- | --- |
| Sweden, with and without VAT ID | Configured Swedish taxable SaaS sale shows 25% added to the exclusive amount |
| Germany, valid business VAT ID | Stripe's reverse-charge decision and invoice note, company and customer VAT IDs |
| Germany, no VAT ID | Stripe's customer classification and applicable tax, without a Komisio override |
| Norway | Stripe's result for the configured registrations and product, not a hard-coded Swedish rate |
| United States | Stripe's result for the actual billing location and registrations |

The table is an operator verification matrix, not hard-coded tax logic.
Stripe collects only where registrations apply; a zero amount alone is not
evidence of reverse charge. See [Checkout tax setup](https://docs.stripe.com/tax/checkout/page)
and [tax ID collection](https://docs.stripe.com/tax/checkout/tax-ids).

## Existing customers and billing location

With the flag on, owner subscription Checkout reuses the stored Stripe customer,
if any, and saves the collected billing address and name through
`customer_update[address]=auto` and `customer_update[name]=auto`.
Before session creation, Komisio checks that customer for a saved shipping
address. If present, Checkout stops with a localized support message.
An operator reviews and corrects the customer in Stripe; Komisio never deletes
or rewrites shipping information. An unavailable or malformed customer lookup
also stops the request.

This is a preflight check, not a lock on Stripe customer edits. Operators must not
add a shipping address during an open Checkout. Subsequent subscription renewals
follow Stripe's address hierarchy, so billing/portal operations must preserve the
intended billing location. See [Stripe's existing-customer rules](https://docs.stripe.com/tax/checkout/page#calculate-tax-for-existing-customers).

Credit packs remain available to owners and admins using `customer_email`.
When tax is enabled, `customer_creation=always` and `invoice_creation[enabled]=true`
create a customer and invoice for the purchase. Admins gain no access to the
store's stored subscription customer.

## Recorded facts and privacy

For completed Checkout events and paid invoices, the existing event `detail`
retains `status` and these allowlisted fields:

| Field | Provider source |
| --- | --- |
| `taxMinor` | Checkout tax total; invoice tax or its complete tax-amount breakdown |
| `totalMinor` | Checkout/invoice total, safe integer minor units |
| `currency` | Provider currency, uppercase |
| `customerCountry` | Billing-address country only |
| `reverseCharge` | Explicit reverse-charge tax reason or customer tax-exempt status |
| `taxIdType` | First provider tax-ID type, such as `eu_vat`; never its value |
| `automaticTax` | Provider automatic-tax status |

Missing or invalid optional facts are null; zero remains zero. Unknown reverse
charge is null, not an inference from country, ID presence or amount.
Other event types keep their existing status-only details. No address or VAT ID
value is stored. Stripe remains the invoice and tax-record source.
The signed webhook, billing actor, existing event IDs and database replay
handling remain unchanged. No new table or retention rule is introduced.
Requests pin Stripe API `2024-06-20`; configure the webhook endpoint for the
same version and review payload contracts before upgrading it.

## Rollout and recovery

After test-mode staging verification, configure production prices, dashboard
settings and webhook version, then explicitly enable the production flag through
the normal release process. Verify a controlled production transaction and its
invoice before general use. Automated tests use synthetic data and stubbed fetch;
they do not prove dashboard configuration, live tax correctness or email delivery.

The hosted environment checker warns when Stripe is configured in production
while the flag is off. Turning it off restores the old creation parameters
(apart from localized Checkout); it also stops requesting automatic tax on new
sessions. It does not alter existing subscriptions or invoices. For a tax-related
incident, stop affected purchases while investigating rather than silently
continuing untaxed sales. Review existing subscriptions separately in Stripe.
