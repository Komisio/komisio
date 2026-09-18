---
name: consignment-sweden
description: Swedish rules and conventions for consignment sales of second-hand goods (kommissionshandel) — commission and VAT, margin scheme, cash-register law, client funds, retention. Use before answering any domain question; never answer from training data.
---

# Consignment sales in Sweden (kommissionshandel)

This skill is the place where domain knowledge is written down before it
becomes code. Statements marked **[verified]** cite a source; statements
marked **[to verify]** are working assumptions that must be checked against
Skatteverket, Bokföringsnämnden or the relevant law before they become rules.
Questions without an answer are in `docs/open-questions.md`.

## Terms

- **Inlämnare / consignor** — the private person or business that hands in
  goods for sale. Owns the goods until they are sold.
- **Kommission** — the store sells in its own name on the consignor's behalf
  and keeps a commission (provision).
- **Avräkningsnota / settlement statement** — the document showing the
  consignor what was sold, the commission taken and the amount owed.
- **Vinstmarginalbeskattning (VMB) / margin scheme** — VAT on the margin
  rather than the price, available under conditions when a VAT-registered
  trader resells used goods bought from someone who could not deduct VAT.
- **Kassaregister** — the certified cash register required for cash/card
  sales to consumers.

## Commission and VAT

- The store's commission is a service and is subject to VAT at the standard
  rate (25 %). **[verified: ML, standard rate for services; confirm section]**
- Towards a private consignor the commission is normally quoted as a
  percentage of the sale price including VAT; the consignor receives price
  minus commission. Towards a business consignor the commission may be
  invoiced with VAT added. **[to verify: common practice, and whether the
  store must issue an invoice for the commission to a business consignor]**
- Whether the sale of the goods themselves carries VAT depends on who the
  seller is in VAT terms: in genuine commission the goods are sold by the
  store in its own name — **[to verify: VAT treatment of the goods in
  försäljningskommission under ML, and how it differs from pure
  förmedling/brokerage]**. This is open question #5 and must be settled
  before "sell an item" is built.

## Margin scheme (VMB)

- Available when a taxable trader resells used goods that were bought from a
  private person, a non-taxable seller, or a seller who applied the margin
  scheme. **[verified in outline: ML 9a kap.; verify exact conditions]**
- Requires that the purchase and sale are documented per item (or per
  period for low-value items under the simplified method). **[to verify:
  thresholds and documentation requirements]**
- A negative margin gives no VAT and cannot offset a positive one in the
  per-item method. **[to verify]**
- Ownership by the store is necessary but not sufficient; eligibility must be
  attested when the item is bought. **[design consequence]**

## Cash register

- Sales to consumers paid by cash or card require a certified cash register
  with a control unit. **[verified in outline: kassaregisterlagen / SFL 39 kap.]**
- Komisio delegates this to the POS provider (Zettle). The core must not
  present itself as a cash register. **[decision, DECISIONS.md 2026-09-10]**

## Consignor funds

- Money owed to consignors is a liability of the store; whether it must be
  held as separate client funds (redovisningsmedel) depends on the agreement
  and the store's practice. **[to verify: obligations under lagen om
  redovisningsmedel for consignment stores]**

## Retention

- Bookkeeping records must be kept for seven years after the end of the
  calendar year in which the financial year ended. **[verified: BFL 7 kap.]**
- Settlement statements and consignment agreements are bookkeeping records
  for the store when they underlie entries. **[to verify: classification]**

## How to use this skill

Answer domain questions from this file. If the answer is **[to verify]**, say
so. If the answer is not here, add the question to `docs/open-questions.md`
and ask; do not guess.

## Default store policy (pilot defaults, not law)

These are the values the engine uses for a tenant that has not published a
store policy. They mirror what the earlier Swedish store ran with and are
overridable per tenant (and, for commission, per seller). They are product
defaults, not legal requirements; nothing here decides VAT treatment.

| Key | Default | Basis |
| --- | --- | --- |
| `commissionBasis` | `inclusive` | Private sellers are quoted a share of the sale price including VAT **[verified: practice, see Commission and VAT above]** |
| `commissionRatePercent` | `60.00` | The store keeps 60 %, the seller receives 40 % of the sale price; the earlier store's published terms **[default, not verified as market norm]** |
| `agreementRequiredFor` | `[]` | Agreement evidence is optional by default; a store may explicitly require it (owner decision 2026-09-18). Existing published policies keep their requirements. |
| `custodySources` | `["staff_receipt"]` | Staff attest custody (owner decision 2026-09-12) |
| `sellerReviewMode` | `delegated` | The seller delegates pricing to the store (owner decision 2026-09-12) |
| `salePeriodDays` | `42` | Six weeks; the earlier store's markdown ladder ended at day 42 |
| `markdownSteps` | `[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}]` | The earlier store's Kompis ladder: minus 10 % at day 14, 25 % at day 28, 50 % at day 42 |
| `endOfPeriodAction` | `charity` | The earlier store donated unsold goods after the period; `return` is the alternative |
| `unsoldNotifyAfterDays` | `60` | The seller is told an item is still unsold at day 60 |
| `minPayoutThreshold` | `100.00` | SEK; the earlier store's seller-facing text stated a 100 kr minimum |
| `assistanceEnabled` | `true` | AI assistance is available from the first day so a new store can try it with its included credits; a person still starts every analysis and the owner can turn it off (owner decision 2026-09-16, replacing the P1 S9 default of `false`) |

Amounts are SEK with two decimals in policy and öre in the database.

## VAT modes (tenant setting; legal sources [to verify] by the store's accountant)

The engine-facing table is `docs/VAT-CASES.md`. This section is the reasoning
and the sources to check. Nothing here is verified; do not compute VAT from it.

**The central question.** In försäljningskommission the store sells in its own
name on the consignor's behalf. Swedish VAT law treats a commissionaire who
sells goods in its own name as if it had itself acquired and supplied the
goods **[to verify: mervärdesskattelagen (2023:200), the rule on supply
through a commissionaire; cite chapter and section]**. If that holds, then for
goods received from a private person the store has "acquired" the goods from
someone who could not charge VAT, which is exactly the situation the margin
scheme (vinstmarginalbeskattning, VMB) covers **[to verify: ML 20 kap. on
used goods, and Skatteverket's guidance on kommissionsförsäljning av begagnade
varor]**. Under that reading:

- Case C1: the store's margin is the sale price minus what the consignor
  receives, which is the commission; VAT is due on that margin only, and the
  consignor's share carries no VAT. This is the treatment the earlier system
  called "commission ex VAT, deduct VAT".
- Case C2: charging VAT on the whole sale price to a consumer, which the
  earlier system used as its default, would overstate VAT if C1 is the correct
  reading. Keep it as a case so that a store that has been applying it can be
  migrated deliberately, not silently.

**Business consignors (C3).** When the consignor is VAT-registered the store's
commission is a service supplied to the consignor and is invoiced with VAT at
the standard rate **[verified in outline: ML, services at 25 %; verify section
and whether an invoice is mandatory]**. Whether the goods themselves then
carry full VAT on the sale depends on the same commissionaire rule as above
**[to verify]**.

**Store-owned goods (C4, C5).** Goods bought from a private person and resold
may use VMB per item when purchase and sale are documented per item, the
margin is price minus purchase price, and a negative margin gives no VAT and
cannot offset a positive one under the per-item method **[verified in outline:
ML 20 kap.; verify the simplified method threshold and the documentation
requirement]**. Eligibility must be attested when the item is bought; this is
why acceptance of a purchase origin records who attested it. Goods bought with
deductible VAT, or without evidence, sell with full VAT (C5).

**Rate and rounding.** Standard rate 25 % **[verified: ML, standard rate]**; no
reduced rate applies to second-hand clothing or household goods **[to
verify]**. Per-line rounding to öre, half up, totals as sums of lines
**[design decision, not law]**.

**Who decides.** Owner decision 2026-09-13: the VAT treatment is a tenant
setting. Each store selects its modes in the store policy, with its
accountant, and Komisio computes the selected mode exactly as documented in
`docs/VAT-CASES.md`. The `[to verify]` marks above are for the store's
accountant, not a gate in the engine; Komisio never claims that a mode is
the legally correct one for a given store, and the settings page says so.
