import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { currencyCode } from './money'
import type { SupabaseClient } from '@supabase/supabase-js'

export const reviewToken = z.string().regex(/^[a-f0-9]{64}$/)
export const reviewAccessCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  reviewId: z.uuid(),
  previousId: z.uuid().nullable(),
  enabled: z.boolean(),
})
export const sellerResponseCommand = z.strictObject({
  token: reviewToken,
  requestId: z.uuid(),
  reviewId: z.uuid(),
  decision: z.enum(['approve', 'decline']),
})
export async function setReviewAccess(client: SupabaseClient, input: unknown) {
  const c = reviewAccessCommand.parse(input)
  const token = c.enabled ? randomBytes(32).toString('hex') : null
  const result = await client.rpc('set_reception_access', {
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_review: c.reviewId,
    p_previous: c.previousId,
    p_hash: token ? createHash('sha256').update(token).digest('hex') : null,
  })
  return { ...result, token: result.error ? null : token }
}
export async function respondToReview(client: SupabaseClient, input: unknown) {
  const c = sellerResponseCommand.parse(input)
  return client.rpc('respond_to_reception_review', {
    p_token: c.token,
    p_request: c.requestId,
    p_review: c.reviewId,
    p_decision: c.decision,
  })
}
const sellerReview = z.object({
  reviewId: z.uuid(),
  version: z.number().int(),
  storeName: z.string(),
  metadata: z.record(z.string(), z.string()),
  photos: z.array(z.uuid()).max(20),
  price: z.object({
    amount: z.string(),
    currency: currencyCode,
    rationale: z.string(),
  }),
  expiresAt: z.string(),
  terms: z.object({
    versionId: z.uuid(),
    title: z.string(),
    body: z.string(),
    language: z.string(),
  }),
  response: z
    .object({ decision: z.enum(['approve', 'decline']), createdAt: z.string() })
    .nullable(),
})
export type SellerReview = z.infer<typeof sellerReview>
export async function readSellerReview(client: SupabaseClient, token: string) {
  const result = await client.rpc('read_seller_review', {
    p_token: reviewToken.parse(token),
  })
  if (result.error) {
    if (
      ['REVIEW_UNAVAILABLE', 'AUTH_REQUIRED'].some((c) =>
        result.error.message.includes(c),
      )
    )
      return null
    throw new Error('Unable to read seller review')
  }
  return sellerReview.parse(result.data)
}
