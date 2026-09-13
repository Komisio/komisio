import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { vatPolicyShape } from './vat'

// Boundary validation only. SQL owns numeric persistence and calculations.
const decimal = z
  .number()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .multipleOf(0.01)
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
  // VAT modes (P2 S10, docs/VAT-CASES.md): optional, chosen by the tenant with its accountant.
  ...vatPolicyShape,
  // Built-in assistance (P1 S9): the tenant switches it on; the server holds the kill switch.
  assistanceEnabled: z.boolean().optional(),
  // Monthly assistance quota (P2 S20): absent means unlimited, 0 blocks the feature.
  assistanceMonthlyQuota: z
    .number()
    .int()
    .nonnegative()
    .max(1_000_000)
    .optional(),
  // Automatic seller notifications (P2 S18): absent means off; every message is logged.
  automaticSellerNotifications: z.boolean().optional(),
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

export const publishStorePolicyCommand = z.strictObject({
  action: z.literal('publishStorePolicy'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  expectedCurrentId: z.uuid().nullable(),
  policy: storePolicyBody,
})
export const effectiveStorePolicy = z.strictObject({
  id: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  policy: storePolicyBody,
})
export async function readStorePolicy(
  client: SupabaseClient,
  tenantInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput)
  const result = await client.rpc('current_store_policy', {
    p_tenant: tenantId,
  })
  if (result.error) throw new Error('FORBIDDEN')
  return effectiveStorePolicy.parse(result.data)
}
