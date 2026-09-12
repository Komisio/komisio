import { z } from 'zod'

// Boundary validation only. SQL owns numeric persistence and calculations.
const decimal = z.number().nonnegative().multipleOf(0.01)
const percent = decimal.max(100)
const days = z.number().int().nonnegative()

/** Explicit S1 body: no commercial defaults until the documented gap is resolved.
 * Parsing is not authorization, policy publication or agreement evidence.
 */
export const storePolicyBody = z.strictObject({
  commissionBasis: z.enum(['inclusive', 'exclusive']),
  commissionRatePercent: percent,
  agreementRequiredFor: z
    .array(z.enum(['bag_receipt', 'review_publication', 'acceptance']))
    .max(3)
    .refine((values) => new Set(values).size === values.length),
  custodySources: z
    .array(z.enum(['staff_receipt', 'locker', 'seller_dropoff']))
    .max(3)
    .refine((values) => new Set(values).size === values.length),
  sellerReviewMode: z.enum(['delegated', 'per_item']),
  salePeriodDays: days.positive(),
  markdownSteps: z.array(z.strictObject({ afterDays: days, percent })),
  endOfPeriodAction: z.enum(['charity', 'return']),
  minPayoutThreshold: decimal,
})

export type StorePolicyBody = z.infer<typeof storePolicyBody>
