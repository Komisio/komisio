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
