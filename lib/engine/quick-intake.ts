import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Quick reception (intake profile "quick"): one call turns a seller's garment
// into an accepted item. The database composes the existing steps in one
// transaction: a source revision with the staff price evidence, a published
// review under the store's current agreement, custody, commercial
// acceptance. Every step keeps its own rules (agreement evidence, seller
// approval when the policy demands it); nothing is bypassed, only chained.
export const quickFacts = z.strictObject({
  description: z.string().trim().min(1).max(1000),
  category: z.string().trim().max(1000).optional(),
  brand: z.string().trim().max(1000).optional(),
  size: z.string().trim().max(1000).optional(),
  color: z.string().trim().max(1000).optional(),
  material: z.string().trim().max(1000).optional(),
  condition: z.string().trim().max(1000).optional(),
})
export const quickReceiveInput = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sellerId: z.uuid(),
  // Sessions created here derive their id from the request (a GUID, not
  // always an RFC UUID); sessions from the photo path are ordinary UUIDs.
  sessionId: z.guid().nullable(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  facts: quickFacts,
  priceOre: z.number().int().positive().max(99_999_999),
})
export type QuickReceiveInput = z.infer<typeof quickReceiveInput>

export const quickReceiveResult = z.object({
  itemId: z.guid(),
  reference: z.string(),
  sessionId: z.guid(),
  garmentId: z.guid(),
  reviewVersion: z.number().int(),
})

export const quickErrorCodes = [
  'FORBIDDEN',
  'INVALID_INPUT',
  'INTAKE_PROFILE_FULL',
  'RECEPTION_NOT_FOUND',
  'RECEPTION_CHANGED',
  'RECEPTION_SESSION_SELLER',
  'AGREEMENT_REQUIRED',
  'SELLER_APPROVAL_REQUIRED',
  'CURRENCY_MISMATCH',
  'ITEM_EXISTS',
  'REQUEST_CONFLICT',
  'PLAN_LIMIT_ITEMS',
  'PLAN_PLUS_REQUIRED',
] as const

export async function quickReceive(client: SupabaseClient, input: unknown) {
  const c = quickReceiveInput.parse(input)
  let sessionId = c.sessionId
  if (!sessionId) {
    // No photo was taken: the session is created here so the request id
    // still names the whole reception.
    const created = await client.rpc('create_reception_session', {
      p_tenant: c.tenantId,
      p_id: derivedId(c.requestId, 'session'),
      p_seller: c.sellerId,
    })
    if (created.error) throw new Error(errorCode(created.error.message))
    sessionId = z.guid().parse(created.data)
  }
  const r = await client.rpc('quick_receive', {
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_session: sessionId,
    p_seller: c.sellerId,
    p_expected: c.expectedRevision,
    p_facts: c.facts,
    p_price_ore: c.priceOre,
  })
  if (r.error) throw new Error(errorCode(r.error.message))
  return quickReceiveResult.parse(r.data)
}

/** A UUID derived from the request id, so a retried request names the same rows. */
export function derivedId(requestId: string, part: string) {
  // Same derivation as the database (komisio_private.derived_uuid): md5 of
  // "<request>:<part>" with the version and variant nibbles of a random UUID.
  const hex = md5(`${requestId}:${part}`)
  const shaped = `${hex.slice(0, 12)}4${hex.slice(13, 16)}8${hex.slice(17)}`
  return `${shaped.slice(0, 8)}-${shaped.slice(8, 12)}-${shaped.slice(12, 16)}-${shaped.slice(16, 20)}-${shaped.slice(20)}`
}

import { createHash } from 'node:crypto'
function md5(text: string) {
  return createHash('md5').update(text).digest('hex')
}

export function errorCode(message: string) {
  return (
    quickErrorCodes.find((code) => message === code) ??
    quickErrorCodes.find((code) => message.includes(code)) ??
    'REQUEST_FAILED'
  )
}
