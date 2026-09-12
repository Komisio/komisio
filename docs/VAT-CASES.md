# VAT cases: engine-facing table

Status: draft, 2026-09-13, derived from `skills/consignment-sweden/SKILL.md`.
No case is verified. The engine records the case id and the basis on every
sale line from P2 S11 onward, but computes no VAT amount for a case until its
row below says `verified` with a source. Commission and seller credit never
depend on these cases. Amounts are öre in the database.

| Case | When it applies | Basis fields frozen on the line | Formula (öre, rounded half up per line) | Status |
| --- | --- | --- | --- | --- |
| `C1_consignment_margin` | Consignment item from a private (non-taxable) seller, store sells in its own name | ownership `consignment`, seller taxable `false`, sale price, seller credit | Margin = price − seller credit (= commission); VAT = margin × rate ÷ (100 + rate); the seller credit carries no VAT | to verify |
| `C2_consignment_full_vat` | Same as C1 but the store applies ordinary VAT on the whole price (the earlier default mode) | as C1 | VAT = price × rate ÷ (100 + rate) | to verify; may be the wrong treatment for goods from private sellers |
| `C3_consignment_business_seller` | Consignment item from a VAT-registered seller; commission is invoiced to the seller plus VAT | ownership `consignment`, seller taxable `true`, seller VAT id, sale price, commission ex VAT | Sale VAT on the whole price as in C2; commission invoice VAT = commission ex VAT × rate ÷ 100 | to verify |
| `C4_store_owned_margin` | Store-owned item bought from a private person, sold under vinstmarginalbeskattning | ownership `store`, purchase price, purchase evidence, margin eligibility attested by (user) at acceptance | Margin = price − purchase price; VAT = max(margin, 0) × rate ÷ (100 + rate); negative margin gives zero and does not offset | to verify |
| `C5_store_owned_full_vat` | Store-owned item without margin eligibility (bought with deductible VAT, or evidence missing) | ownership `store`, purchase price, purchase VAT deducted `true` | VAT = price × rate ÷ (100 + rate) | to verify |

Rate: 25 % unless a verified exception is added. Rounding: per line, öre,
half up; totals are sums of lines, never re-rounded.

Rules the engine enforces regardless of verification:

- A line has exactly one case id, chosen at sale time from the item's frozen
  ownership and the tenant's verified cases; if the only applicable case is
  unverified, the line stores the case id and basis and leaves `vat_amount`
  null, and the day close reports that day as "VAT pending".
- The basis fields for the case must all be present on the line or the sale
  is rejected with `VAT_BASIS_MISSING`.
- C4 requires an attestation at acceptance (who, when) that the purchase
  evidence supports margin eligibility; without it the item sells under C5.

Verification checklist per case: the legal source (mervärdesskattelagen
chapter and section, or Skatteverket guidance page), one worked example in
öre agreed with the store's accountant, and the owner's mark in the skill.
