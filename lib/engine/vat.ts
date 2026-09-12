import { z } from 'zod'

// VAT modes are a tenant setting (DECISIONS.md 2026-09-13). This module computes
// each mode exactly as docs/VAT-CASES.md states: integer öre in, integer öre out,
// rounding half up per line, no floating point. It never decides which mode a
// store should use. komisio_private.vat_for_line in SQL implements the same
// arithmetic; the worked examples in both test suites must agree.

export const vatMode = z.enum([
  'consignment_margin',
  'consignment_full',
  'consignment_business',
  'store_margin',
  'store_full',
])
export type VatMode = z.infer<typeof vatMode>

const ore = z.number().int().nonnegative().max(99_999_999_999)
/** Rate in basis points: 25 % is 2500. */
export const rateBasisPoints = z.number().int().min(0).max(10_000)

/** Tenant policy keys from docs/VAT-CASES.md, spread into the store policy body
 * (lib/engine/store-policy.ts). All optional: absent mode means the tenant has not
 * chosen, absent rate means 25.00. Komisio never picks a mode for a store. */
export const vatPolicyShape = {
  vatModeConsignmentPrivate: z
    .enum(['consignment_margin', 'consignment_full'])
    .optional(),
  vatModeStoreOwned: z.enum(['store_margin', 'store_full']).optional(),
  vatRatePercent: z.number().nonnegative().max(100).multipleOf(0.01).optional(),
}
/** Non-strict so a whole store policy can be passed; extra keys are ignored. */
export const vatPolicy = z.object(vatPolicyShape)
export type VatPolicy = z.infer<typeof vatPolicy>
export const DEFAULT_VAT_RATE_PERCENT = 25

/** 25 → 2500; two-decimal percent to basis points without float drift. */
export function rateBasisPointsFromPercent(percent: number) {
  const m = /^(\d{1,3})\.(\d{2})$/.exec(
    z
      .number()
      .nonnegative()
      .max(100)
      .multipleOf(0.01)
      .parse(percent)
      .toFixed(2),
  )
  if (!m) throw new Error('INVALID_INPUT')
  return rateBasisPoints.parse(Number(m[1]) * 100 + Number(m[2]))
}

/** The tenant's rate in basis points, 25 % when the policy does not set one. */
export function vatRateBasisPoints(policyInput: unknown) {
  const p = vatPolicy.parse(policyInput)
  return rateBasisPointsFromPercent(
    p.vatRatePercent ?? DEFAULT_VAT_RATE_PERCENT,
  )
}

export const vatLineContext = z.strictObject({
  ownership: z.enum(['consignment', 'store']),
  sellerTaxable: z.boolean(),
  /** Attested at acceptance that purchase evidence supports margin eligibility. */
  marginAttested: z.boolean(),
})

/** The one mode for a line, from frozen item facts and the tenant's policy. Throws VAT_MODE_NOT_SET. */
export function selectVatMode(
  contextInput: unknown,
  policyInput: unknown,
): VatMode {
  const c = vatLineContext.parse(contextInput),
    p = vatPolicy.parse(policyInput)
  if (c.ownership === 'consignment') {
    if (c.sellerTaxable) return 'consignment_business'
    if (!p.vatModeConsignmentPrivate) throw new Error('VAT_MODE_NOT_SET')
    return p.vatModeConsignmentPrivate
  }
  if (!p.vatModeStoreOwned) throw new Error('VAT_MODE_NOT_SET')
  // Without an attestation the item sells under store_full, never on margin.
  return p.vatModeStoreOwned === 'store_margin' && !c.marginAttested
    ? 'store_full'
    : p.vatModeStoreOwned
}

export const vatBasis = z.strictObject({
  priceOre: ore,
  sellerCreditOre: ore.optional(),
  purchasePriceOre: ore.optional(),
  commissionExVatOre: ore.optional(),
})
export type VatBasis = z.infer<typeof vatBasis>

/** amount × rate ÷ (10000 + rate), rounded half up, in integers. */
function vatFromGross(amountOre: number, rateBp: number) {
  if (amountOre <= 0 || rateBp <= 0) return 0
  const num = BigInt(amountOre) * BigInt(rateBp),
    den = BigInt(10_000 + rateBp)
  return Number((num * 2n + den) / (2n * den))
}

/** amount × rate ÷ 10000, rounded half up: VAT added on top of a net amount. */
function vatOnNet(amountOre: number, rateBp: number) {
  if (amountOre <= 0 || rateBp <= 0) return 0
  const num = BigInt(amountOre) * BigInt(rateBp),
    den = 10_000n
  return Number((num * 2n + den) / (2n * den))
}

/** VAT on the sale line for the selected mode. Throws VAT_BASIS_MISSING when the mode's basis is absent. */
export function vatForLine(
  modeInput: unknown,
  basisInput: unknown,
  rateInput: unknown,
): number {
  const mode = vatMode.parse(modeInput),
    b = vatBasis.parse(basisInput),
    rate = rateBasisPoints.parse(rateInput)
  switch (mode) {
    case 'consignment_margin': {
      if (b.sellerCreditOre === undefined) throw new Error('VAT_BASIS_MISSING')
      return vatFromGross(b.priceOre - b.sellerCreditOre, rate)
    }
    case 'consignment_full':
    case 'consignment_business':
    case 'store_full':
      return vatFromGross(b.priceOre, rate)
    case 'store_margin': {
      if (b.purchasePriceOre === undefined) throw new Error('VAT_BASIS_MISSING')
      return vatFromGross(Math.max(b.priceOre - b.purchasePriceOre, 0), rate)
    }
  }
}

/** VAT on the commission invoice to a VAT-registered seller (consignment_business only). */
export function commissionInvoiceVat(
  commissionExVatOre: unknown,
  rateInput: unknown,
): number {
  return vatOnNet(
    ore.parse(commissionExVatOre),
    rateBasisPoints.parse(rateInput),
  )
}

/** The examples docs/VAT-CASES.md promises; the SQL test asserts the same rows. */
export const vatWorkedExamples: Array<{
  mode: VatMode
  basis: VatBasis
  rateBp: number
  vatOre: number
}> = [
  {
    mode: 'consignment_margin',
    basis: { priceOre: 25_000, sellerCreditOre: 10_000 },
    rateBp: 2_500,
    vatOre: 3_000,
  },
  {
    mode: 'consignment_full',
    basis: { priceOre: 25_000 },
    rateBp: 2_500,
    vatOre: 5_000,
  },
  {
    mode: 'consignment_business',
    basis: { priceOre: 25_000, commissionExVatOre: 12_000 },
    rateBp: 2_500,
    vatOre: 5_000,
  },
  {
    mode: 'store_margin',
    basis: { priceOre: 25_000, purchasePriceOre: 15_000 },
    rateBp: 2_500,
    vatOre: 2_000,
  },
  {
    mode: 'store_margin',
    basis: { priceOre: 10_000, purchasePriceOre: 15_000 },
    rateBp: 2_500,
    vatOre: 0,
  },
  {
    mode: 'store_full',
    basis: { priceOre: 25_000 },
    rateBp: 2_500,
    vatOre: 5_000,
  },
  // 999 öre × 2500 ÷ 12500 = 199.8 → 200: half up.
  { mode: 'store_full', basis: { priceOre: 999 }, rateBp: 2_500, vatOre: 200 },
  // 1 öre × 2500 ÷ 12500 = 0.2 → 0.
  { mode: 'store_full', basis: { priceOre: 1 }, rateBp: 2_500, vatOre: 0 },
  // 7 öre × 1000 ÷ 11000 = 0.636 → 1.
  { mode: 'store_full', basis: { priceOre: 7 }, rateBp: 1_000, vatOre: 1 },
]
