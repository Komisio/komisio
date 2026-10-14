import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const count = z.number().int().nonnegative()
export const privacyPreview = z.object({
  sellerId: z.uuid(),
  closedAt: z.string().nullable(),
  canErase: z.boolean(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  blockers: z.object({
    balance: z.boolean(),
    fees: count,
    payouts: count,
    items: count,
    bags: count,
    handovers: count,
    garments: count,
    messages: count,
    legacyStatements: count,
  }),
  counts: z.object({
    profiles: count,
    ordinaryMessages: count,
    reviewContacts: count,
    statements: count,
    agreements: count,
    financialMessages: count,
    ledger: count,
    receptions: count,
    submissions: count,
  }),
  history: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['contact_erased', 'retention_reviewed']),
      retention_reason: z.string(),
      review_on: z.string(),
      created_at: z.string(),
    }),
  ),
})
export type SellerPrivacyPreview = z.infer<typeof privacyPreview>
export const eraseSellerContactCommand = z.strictObject({
  action: z.enum(['erase', 'review']),
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  requestId: z.uuid(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
  reviewOn: z.iso.date(),
  confirmed: z.literal(true),
})
export const privacyErrors = [
  'FORBIDDEN',
  'SELLER_NOT_FOUND',
  'PRIVACY_CHANGED',
  'PRIVACY_BLOCKED',
  'REQUEST_CONFLICT',
  'INVALID_INPUT',
] as const
function fail(message: string): never {
  throw new Error(
    privacyErrors.find((code) => message === code) ?? 'REQUEST_FAILED',
  )
}
export async function readSellerPrivacy(
  client: SupabaseClient,
  tenantId: string,
  sellerId: string,
) {
  const result = await client.rpc('seller_privacy_preview', {
    p_tenant: z.uuid().parse(tenantId),
    p_seller: z.uuid().parse(sellerId),
  })
  if (result.error) fail(result.error.message)
  return privacyPreview.parse(result.data)
}
export async function eraseSellerContact(
  client: SupabaseClient,
  input: z.infer<typeof eraseSellerContactCommand>,
) {
  const c = eraseSellerContactCommand.parse(input)
  const result = await client.rpc(
    c.action === 'erase' ? 'erase_seller_contact' : 'review_seller_retention',
    {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_seller: c.sellerId,
      p_revision: c.revision,
      p_reason: c.reason,
      p_review_on: c.reviewOn,
      p_confirm: c.confirmed,
    },
  )
  if (result.error) fail(result.error.message)
  return z.uuid().parse(result.data)
}
