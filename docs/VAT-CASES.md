# VAT cases: engine-facing table

Status: accepted design, 2026-09-13 (owner decision: VAT treatment is a
tenant setting). Komisio does not decide which treatment is legally right for
a store. Each tenant selects its VAT modes in the store policy, together with
its accountant; Komisio guarantees that every mode is computed
deterministically as documented here, records the mode and basis on every
sale line, and never changes a line afterwards. Commission and seller credit
never depend on the mode. Amounts are öre in the database. The reasoning and
the legal sources to check per mode are in `skills/consignment-sweden/SKILL.md`.

## Modes

| Mode | When a tenant would select it | Basis fields frozen on the line | Formula (öre, rounded half up per line) |
| --- | --- | --- | --- |
| `consignment_margin` | Consignment goods from private sellers, VAT on the store's margin (commission) only | ownership `consignment`, seller taxable `false`, sale price, seller credit | Margin = price − seller credit; VAT = margin × rate ÷ (100 + rate); the seller credit carries no VAT |
| `consignment_full` | Consignment goods, ordinary VAT on the whole sale price (the earlier store's default) | as above | VAT = price × rate ÷ (100 + rate) |
| `consignment_business` | Consignment goods from a VAT-registered seller; commission invoiced to the seller plus VAT | ownership `consignment`, seller taxable `true`, seller VAT id, sale price, commission ex VAT | Sale VAT on the whole price as in `consignment_full`; commission invoice VAT = commission ex VAT × rate ÷ 100 |
| `store_margin` | Store-owned goods bought from private persons, vinstmarginalbeskattning per item | ownership `store`, purchase price, purchase evidence, margin eligibility attested by (user, time) at acceptance | Margin = price − purchase price; VAT = max(margin, 0) × rate ÷ (100 + rate); negative margin gives zero and never offsets |
| `store_full` | Store-owned goods without margin eligibility | ownership `store`, purchase price, purchase VAT deducted `true` | VAT = price × rate ÷ (100 + rate) |

Rate: 25 % by default, a policy value. Rounding: per line, öre, half up;
totals are sums of lines, never re-rounded.

## Tenant policy keys (P1 S1)

| Key | Values | Default |
| --- | --- | --- |
| `vatModeConsignmentPrivate` | `consignment_margin` \| `consignment_full` | none: the tenant must choose before its first sale |
| `vatModeConsignmentBusiness` | `consignment_business` | fixed |
| `vatModeStoreOwned` | `store_margin` \| `store_full`, with `store_full` as the fallback when eligibility is not attested | none: must choose |
| `vatRatePercent` | numeric | `25.00` |

## Rules the engine enforces

- A sale cannot be recorded for a tenant that has not chosen its modes;
  `record_sale` fails with `VAT_MODE_NOT_SET`. Choosing a mode is an
  owner-or-admin policy publication and is logged like any policy change.
- A line has exactly one mode, chosen at sale time from the item's frozen
  ownership, the seller's taxable flag and the tenant's policy at that
  moment; mode, basis and computed amount are frozen on the line.
- The basis fields for the mode must all be present on the line or the sale
  is rejected with `VAT_BASIS_MISSING`.
- `store_margin` requires an attestation at acceptance (who, when) that the
  purchase evidence supports margin eligibility; without it the item sells
  under `store_full`.
- A tenant that changes mode changes only future lines; the day close shows
  totals per mode so a change is visible in the books.
- Every mode has a pure, tested function and a worked example in öre in the
  test suite; the tests are the specification of the arithmetic.

Komisio's responsibility ends at deterministic, documented computation. The
choice of mode, and its correctness for the store, is the tenant's, made with
its accountant; the settings page says so in plain words and links the skill.
