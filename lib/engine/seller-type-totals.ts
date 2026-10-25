import { z } from 'zod'
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const sellerTypeTotals = z.partialRecord(
  z.enum(['private', 'business']),
  z.object({
    grossOre: ore,
    vatOre: ore,
    sellerCreditOre: ore,
    refundsOre: ore,
    creditReversedOre: ore,
    payoutsPaidOre: ore,
  }),
)
export type SellerTypeTotals = z.infer<typeof sellerTypeTotals>
