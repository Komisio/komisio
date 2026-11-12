import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { centralParcel, centralParcelCommand } from './central-parcel-schema'
import {
  bookPostNordReturn,
  type PostNordConfiguration,
} from '../platform/postnord'

const allowedErrors = new Set([
  'PHONE_VERIFICATION_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'PARCEL_EXISTS',
  'PARCEL_GROUP_UNSUPPORTED',
  'HANDOVER_CLOSED',
  'SHIPPING_UNAVAILABLE',
  'SHIPPING_CONTACT_UNSUPPORTED',
  'OFFER_NOT_FOUND',
  'SELLER_CLOSED',
  'PLAN_READ_ONLY',
])
function failure(message: string): never {
  throw new Error(allowedErrors.has(message) ? message : 'REQUEST_FAILED')
}
export async function executeCentralParcel(
  client: SupabaseClient,
  input: unknown,
  config: PostNordConfiguration | null,
  transport: typeof fetch = fetch,
) {
  const c = centralParcelCommand.parse(input)
  if (c.action === 'read') {
    const r = await client.rpc('read_central_parcel', { p_offer: c.offerId })
    if (r.error) failure(r.error.message)
    const data = z
      .object({
        offerId: z.literal(c.offerId),
        configured: z.boolean(),
        parcel: centralParcel.nullable(),
      })
      .parse(r.data)
    return {
      offerId: data.offerId,
      parcel: data.parcel,
      available: config !== null && data.configured,
    }
  }
  if (!config) throw new Error('SHIPPING_UNAVAILABLE')
  const r = await client.rpc('claim_central_parcel', {
    p_id: c.requestId,
    p_offer: c.offerId,
    p_address: c.address,
    p_weight: c.weightG,
    p_length: c.lengthMm,
    p_width: c.widthMm,
    p_height: c.heightMm,
    p_environment: config.environment,
  })
  if (r.error) failure(r.error.message)
  const claim = z
    .object({
      dispatch: z.boolean(),
      parcel: centralParcel,
      handoverReference: z.string().optional(),
      messageId: z.string().optional(),
    })
    .parse(r.data)
  if (claim.parcel.id !== c.requestId) throw new Error('REQUEST_FAILED')
  if (claim.dispatch) {
    let result = null
    try {
      if (!claim.handoverReference || !claim.messageId)
        throw new Error('INVALID_CLAIM')
      result = await bookPostNordReturn(
        config,
        claim.parcel,
        claim.handoverReference,
        claim.messageId,
        transport,
      )
    } catch {
      // No response is not evidence that PostNord rejected the booking.
    }
    const saved = await client.rpc('finish_central_parcel', {
      p_id: c.requestId,
      p_result: result,
    })
    if (saved.error) failure(saved.error.message)
  }
  return { id: c.requestId }
}
