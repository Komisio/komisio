import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { centralParcel } from './central-parcel-schema'
import {
  bookPostNordParcel,
  type PostNordConfiguration,
} from '../platform/postnord'

export const centralReviewCommand = z
  .strictObject({
    action: z.enum(['approve', 'approveAndBook']),
    tenantId: z.uuid(),
    commandId: z.uuid(),
    ownerId: z.uuid(),
    expectedRevision: z.number().int().min(1).max(2147483646),
    items: z
      .array(
        z.strictObject({
          requestId: z.uuid(),
          expectedSalePriceOre: z.string().regex(/^[1-9]\d{0,10}$/),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine(
    (c) => new Set(c.items.map((i) => i.requestId)).size === c.items.length,
  )
const errors = new Set([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'REQUEST_CHANGED',
  'REQUEST_NOT_FOUND',
  'OFFER_NOT_FOUND',
  'SELLER_CLOSED',
  'PLAN_READ_ONLY',
  'STORE_UNAVAILABLE',
  'FIXED_PRICE_REQUIRED',
  'PROFILE_CHANGED',
  'SHIPPING_UNAVAILABLE',
  'SHIPPING_CONTACT_UNSUPPORTED',
  'PARCEL_EXISTS',
  'PARCEL_GROUP_UNSUPPORTED',
  'PARCEL_WEIGHT_LIMIT',
  'HANDOVER_CLOSED',
])
const check = (error: { message: string } | null) => {
  if (error)
    throw new Error(
      errors.has(error.message) ? error.message : 'REQUEST_FAILED',
    )
}
export async function executeCentralReview(
  client: SupabaseClient,
  input: unknown,
  config: PostNordConfiguration | null,
  transport: typeof fetch = fetch,
) {
  const c = centralReviewCommand.parse(input)
  const book = c.action === 'approveAndBook'
  if (book && !config) throw new Error('SHIPPING_UNAVAILABLE')
  const r = await client.rpc('review_central_item_group', {
    p_id: c.commandId,
    p_tenant: c.tenantId,
    p_owner: c.ownerId,
    p_items: c.items,
    p_book: book,
    p_revision: c.expectedRevision,
    p_environment: book ? config!.environment : null,
  })
  check(r.error)
  const claim = z
    .object({
      id: z.uuid().optional(),
      dispatch: z.boolean(),
      parcel: centralParcel.nullable(),
      handoverReference: z.string().optional(),
      messageId: z.string().optional(),
    })
    .parse(r.data)
  if (
    book
      ? claim.parcel?.id !== c.commandId
      : claim.id !== c.commandId || claim.dispatch || claim.parcel !== null
  )
    throw new Error('UNCONFIRMED_RESULT')
  if (claim.dispatch) {
    if (
      !claim.parcel ||
      !config ||
      !claim.handoverReference ||
      !claim.messageId
    )
      throw new Error('UNCONFIRMED_RESULT')
    let result = null
    try {
      result = await bookPostNordParcel(
        config,
        claim.parcel,
        claim.handoverReference,
        claim.messageId,
        transport,
      )
    } catch {
      /* Unknown provider outcome is held; never infer permission to rebook. */
    }
    const saved = await client.rpc('finish_staff_central_parcel', {
      p_id: c.commandId,
      p_result: result,
    })
    check(saved.error)
    return {
      id: c.commandId,
      shippingStatus: result ? 'booked' : 'needs_review',
    }
  }
  return { id: c.commandId, shippingStatus: claim.parcel?.status ?? null }
}
