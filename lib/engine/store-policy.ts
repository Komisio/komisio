import { z } from 'zod'

// Boundary validation only. SQL owns numeric persistence and calculations.
const decimal = z.number().nonnegative().multipleOf(0.01)
const percent = decimal.max(100)
const days = z.number().int().nonnegative()

/** Explicit S1 body; default values are selected separately, never merged into input.
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
  unsoldNotifyAfterDays: days,
  markdownSteps: z.array(z.strictObject({ afterDays: days, percent })),
  endOfPeriodAction: z.enum(['charity', 'return']),
  minPayoutThreshold: decimal,
})

export type StorePolicyBody = z.infer<typeof storePolicyBody>

/** Owner-confirmed pilot policy, not law or automatic execution authority.
 * Mirrors the skill's Default store policy section at Fable snapshot 17e73c8.
 * A fresh parsed object prevents callers from changing another tenant's defaults.
 * Assistance enablement belongs to S9 and is deliberately absent from S1.
 */
export function defaultStorePolicy(): StorePolicyBody {
  return storePolicyBody.parse({
    commissionBasis: 'inclusive',
    commissionRatePercent: 60,
    agreementRequiredFor: ['review_publication', 'acceptance'],
    custodySources: ['staff_receipt'],
    sellerReviewMode: 'delegated',
    salePeriodDays: 42,
    markdownSteps: [
      { afterDays: 14, percent: 10 },
      { afterDays: 28, percent: 25 },
      { afterDays: 42, percent: 50 },
    ],
    endOfPeriodAction: 'charity',
    unsoldNotifyAfterDays: 60,
    minPayoutThreshold: 100,
  })
}
