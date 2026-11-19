import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  centralParcel,
  centralParcelCommand,
  parcelItem,
  senderAddress,
} from './central-parcel-schema'
import {
  bookPostNordParcel,
  type PostNordConfiguration,
} from '../platform/postnord'

const allowedErrors = new Set([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'STAFF_BOOKING_REQUIRED',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'PARCEL_EXISTS',
  'PARCEL_GROUP_UNSUPPORTED',
  'PARCEL_WEIGHT_LIMIT',
  'HANDOVER_CLOSED',
  'SHIPPING_UNAVAILABLE',
  'SHIPPING_CONTACT_UNSUPPORTED',
  'OFFER_NOT_FOUND',
  'REQUEST_CHANGED',
  'OFFER_EXPIRED',
  'AGREEMENT_CHANGED',
  'SELLER_CLOSED',
  'PLAN_READ_ONLY',
])
function failure(message: string): never {
  throw new Error(allowedErrors.has(message) ? message : 'REQUEST_FAILED')
}
async function acceptAndBookAlternative(
  client: SupabaseClient,
  command: Extract<
    z.infer<typeof centralParcelCommand>,
    { action: 'acceptAlternative' }
  >,
  config: PostNordConfiguration | null,
  transport: typeof fetch,
): Promise<{ id: string }> {
  const { requestId, offerId, agreementVersionId } = command
  const accepted = await client.rpc('accept_central_price_alternative', {
    p_id: requestId,
    p_offer: offerId,
    p_agreement: agreementVersionId,
  })
  if (accepted.error) failure(accepted.error.message)
  if (accepted.data !== requestId) throw new Error('REQUEST_FAILED')
  // Consent survives a carrier outage. Reopen the ordinary shipping screen to
  // recover a missing address or show an existing/pending carrier outcome.
  if (!config) return { id: requestId }
  const existing = await client.rpc('read_central_parcel', { p_offer: offerId })
  if (existing.error) failure(existing.error.message)
  const state = z
    .object({ offerId: z.literal(offerId), parcel: centralParcel.nullable() })
    .parse(existing.data)
  if (state.parcel) return { id: requestId }
  const saved = await client.rpc('read_my_central_shipping_address')
  if (saved.error) failure(saved.error.message)
  const account = saved.data?.account
  const address = senderAddress.safeParse({
    ...account?.address,
    ...account?.contact,
  })
  if (!address.success) return { id: requestId }
  try {
    await executeCentralParcel(
      client,
      {
        action: 'book',
        requestId,
        offerId,
        offerIds: [offerId],
        address: address.data,
      },
      config,
      transport,
    )
  } catch (error) {
    if (
      !(error instanceof Error) ||
      ![
        'PARCEL_EXISTS',
        'SHIPPING_UNAVAILABLE',
        'SHIPPING_CONTACT_UNSUPPORTED',
        'PARCEL_WEIGHT_LIMIT',
        'HANDOVER_CLOSED',
      ].includes(error.message)
    )
      throw error
  }
  return { id: requestId }
}
export async function executeCentralParcel(
  client: SupabaseClient,
  input: unknown,
  config: PostNordConfiguration | null,
  transport: typeof fetch = fetch,
) {
  const c = centralParcelCommand.parse(input)
  if (c.action === 'acceptAlternative')
    return acceptAndBookAlternative(client, c, config, transport)
  if (c.action === 'read') {
    const r = await client.rpc('read_central_parcel', { p_offer: c.offerId })
    if (r.error) failure(r.error.message)
    const data = z
      .object({
        offerId: z.literal(c.offerId),
        configured: z.boolean(),
        staffManaged: z.boolean().default(false),
        selectionWeightLimitG: z
          .union([z.literal(2000), z.literal(2500)])
          .nullish(),
        parcel: centralParcel.nullable(),
        eligibleItems: z.array(parcelItem).max(10).default([]),
      })
      .parse(r.data)
    return {
      offerId: data.offerId,
      parcel: data.parcel,
      staffManaged: data.staffManaged,
      available: config !== null && data.configured,
      measurementsOptional: true,
      bundlingAvailable: true,
      eligibleItems: data.eligibleItems,
      // Public build 83 rejects any explicit limit other than 2000. Keep its
      // conservative selector working until the client opts into protocol 2.
      ...(data.selectionWeightLimitG != null
        ? {
            selectionWeightLimitG:
              c.protocol === 2 ? data.selectionWeightLimitG : 2000,
          }
        : {}),
    }
  }
  if (!config) throw new Error('SHIPPING_UNAVAILABLE')
  const r = await client.rpc(
    c.offerIds ? 'claim_central_parcel_group' : 'claim_central_parcel',
    {
      p_id: c.requestId,
      p_offer: c.offerId,
      p_address: c.address,
      ...(c.offerIds
        ? { p_offers: c.offerIds }
        : {
            p_weight: c.weightG ?? null,
            p_length: c.lengthMm ?? null,
            p_width: c.widthMm ?? null,
            p_height: c.heightMm ?? null,
          }),
      p_environment: config.environment,
    },
  )
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
      result = await bookPostNordParcel(
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
