import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
export const externalRequestStatuses = [
  'all',
  'waiting',
  'offered',
  'accepted',
  'open',
  'received',
  'registered',
  'expired',
  'rejected',
  'declined',
  'cancelled',
] as const
export type ExternalRequestStatus = (typeof externalRequestStatuses)[number]
export type ExternalRequestFilters = {
  status: ExternalRequestStatus
  query: string
}

const uuid = z.uuid().transform((value) => value.toLowerCase())
const ore = z.string().regex(/^[1-9]\d{0,10}$/)
const time = z.iso.datetime({ offset: true })
const offerGuarantee = z
  .object({
    id: uuid,
    amountOre: ore,
    currency: z.literal('SEK'),
    receivedAt: time,
    dueAt: time,
    creditedAt: time.nullable(),
    itemId: z.guid().nullish(),
    registeredAt: time.nullish(),
  })
  .refine((g) => Boolean(g.itemId) === Boolean(g.registeredAt))
  .refine(
    (g) =>
      Date.parse(g.dueAt) - Date.parse(g.receivedAt) ===
      45 * 24 * 60 * 60 * 1000,
  )
const offerHandover = z
  .object({
    id: uuid,
    reference: z.string().regex(/^H-[1-9]\d{0,11}$/),
    status: z.enum(['open', 'received', 'cancelled']),
    receivedAt: time.nullable(),
    itemCount: z.number().int().min(1).max(10),
  })
  .refine((h) => (h.status === 'received') === (h.receivedAt !== null))
export const externalOfferSummary = z.object({
  id: uuid,
  requestId: uuid,
  tenantId: uuid,
  sellerAmountOre: ore,
  expectedSalePriceOre: ore,
  currency: z.literal('SEK'),
  agreementVersionId: uuid,
  createdAt: time,
  expiresAt: time,
  status: z.enum(['offered', 'accepted', 'declined', 'expired', 'superseded']),
  canAccept: z.boolean(),
  canDecline: z.boolean(),
  serverNow: time,
  response: z
    .object({ id: uuid, accepted: z.boolean(), createdAt: time })
    .nullable(),
  // Older deployed reads omit this additive field during rollout.
  handover: offerHandover.nullish(),
  guarantee: offerGuarantee.nullish(),
})
export const externalOfferDetail = externalOfferSummary
  .extend({
    agreement: z.object({
      id: uuid,
      version: z.number().int().positive(),
      title: z.string().min(1).max(120),
      body: z.string().min(1).max(12000),
      language: z.string().min(2).max(10),
    }),
  })
  .refine((v) => v.agreement.id === v.agreementVersionId)
export const externalOfferPage = z.object({
  offers: z.array(externalOfferSummary).max(25),
  serverNow: time,
})
export type ExternalOfferSummary = z.infer<typeof externalOfferSummary>
export type ExternalOfferDetail = z.infer<typeof externalOfferDetail>

export const externalOfferCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    requestIds: z
      .array(uuid)
      .max(25)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.strictObject({ action: z.literal('read'), offerId: uuid }),
  z.strictObject({
    action: z.literal('respond'),
    requestId: uuid,
    offerId: uuid,
    accepted: z.boolean(),
    agreementVersionId: uuid.nullable(),
  }),
])
export const issueExternalOfferCommand = z.strictObject({
  action: z.literal('offer'),
  tenantId: uuid,
  commandId: uuid,
  requestId: uuid,
  previousOfferId: uuid.nullable(),
  sellerAmountOre: ore,
  expectedSalePriceOre: ore,
  agreementVersionId: uuid,
})
export const reviewExternalRequestCommand = z.discriminatedUnion('action', [
  issueExternalOfferCommand,
  z.strictObject({
    action: z.literal('decline'),
    tenantId: uuid,
    commandId: uuid,
    requestId: uuid,
    note: z.string().trim().max(1000),
  }),
])
export async function reviewExternalRequest(
  client: SupabaseClient,
  input: unknown,
) {
  const c = reviewExternalRequestCommand.parse(input)
  if (c.action === 'offer') return issueExternalOffer(client, c)
  const r = await client.rpc('decline_external_item_request', {
    p_id: c.commandId,
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_note: c.note,
  })
  check(r.error)
  if (r.data !== c.commandId) throw new Error('REQUEST_FAILED')
  return { id: c.commandId }
}
const safeErrors = new Set([
  'PHONE_VERIFICATION_REQUIRED',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'REQUEST_CHANGED',
  'REQUEST_NOT_FOUND',
  'OFFER_NOT_FOUND',
  'OFFER_EXPIRED',
  'OFFER_ACTIVE',
  'OFFER_ACCEPTED',
  'AGREEMENT_CHANGED',
  'PLAN_READ_ONLY',
  'STORE_UNAVAILABLE',
])
function check(error: { message: string } | null) {
  if (error)
    throw new Error(
      safeErrors.has(error.message) ? error.message : 'REQUEST_FAILED',
    )
}
export async function executeExternalOfferCommand(
  client: SupabaseClient,
  input: unknown,
) {
  const c = externalOfferCommand.parse(input)
  if (c.action === 'list') {
    const r = await client.rpc('my_external_item_offers', {
      p_requests: c.requestIds,
    })
    check(r.error)
    const page = externalOfferPage.parse(r.data)
    if (
      page.offers.some((o) => !c.requestIds.includes(o.requestId)) ||
      new Set(page.offers.map((o) => o.requestId)).size !== page.offers.length
    )
      throw new Error('REQUEST_FAILED')
    return page
  }
  if (c.action === 'read') {
    const r = await client.rpc('read_external_item_offer', {
      p_offer: c.offerId,
    })
    check(r.error)
    const offer = externalOfferDetail.parse(r.data)
    if (offer.id !== c.offerId) throw new Error('REQUEST_FAILED')
    return offer
  }
  const r = await client.rpc('respond_external_item_offer', {
    p_id: c.requestId,
    p_offer: c.offerId,
    p_accepted: c.accepted,
    p_agreement: c.agreementVersionId,
  })
  check(r.error)
  if (r.data !== c.requestId) throw new Error('REQUEST_FAILED')
  return { id: c.requestId }
}
export async function issueExternalOffer(
  client: SupabaseClient,
  input: unknown,
) {
  const c = issueExternalOfferCommand.parse(input)
  const r = await client.rpc('issue_external_item_offer', {
    p_tenant: c.tenantId,
    p_id: c.commandId,
    p_request: c.requestId,
    p_previous: c.previousOfferId,
    p_amount_ore: c.sellerAmountOre,
    p_sale_price_ore: c.expectedSalePriceOre,
    p_agreement: c.agreementVersionId,
  })
  check(r.error)
  if (r.data !== c.commandId) throw new Error('REQUEST_FAILED')
  return { id: c.commandId }
}

const queueRow = z.object({
  queue_status: z.enum(externalRequestStatuses).exclude(['all']),
  id: uuid,
  owner_id: uuid,
  description: z.string(),
  brand: z.string(),
  condition: z.enum(['like_new', 'very_good', 'good', 'worn']),
  notes: z.string(),
  currency: z.string(),
  desired_price_ore: ore.nullable(),
  photos: z.array(uuid).min(1).max(8),
  created_at: time,
  declined: z.boolean(),
  decline_note: z.string().nullable(),
  agreement_version_id: uuid.nullable(),
  offer: externalOfferSummary.nullable(),
})
export type ExternalRequestRow = z.infer<typeof queueRow>
export async function readExternalOfferQueue(
  client: SupabaseClient,
  tenantId: string,
  page: number,
  filters: ExternalRequestFilters = { status: 'all', query: '' },
) {
  const r = await client.rpc('external_item_offer_queue_filtered', {
    p_tenant: uuid.parse(tenantId),
    p_offset: (z.number().int().min(1).max(4001).parse(page) - 1) * 25,
    p_status: z.enum(externalRequestStatuses).parse(filters.status),
    p_query: z.string().trim().max(120).parse(filters.query),
  })
  check(r.error)
  return z
    .object({
      rows: z.array(queueRow).max(25),
      total: z.number().int().nonnegative(),
    })
    .parse(r.data)
}
