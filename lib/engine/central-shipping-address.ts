import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parcelAddress } from './central-parcel-schema'

export const centralAddressCommand = z.union([
  z.strictObject({ action: z.literal('read') }),
  z.strictObject({
    action: z.literal('save'),
    requestId: z.uuid(),
    tenantId: z.uuid(),
    sellerId: z.uuid(),
    expectedRevision: z.number().int().min(0).max(2147483646),
    address: parcelAddress,
  }),
])
const account = z.object({
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  revision: z.number().int().nonnegative(),
  address: parcelAddress.nullable(),
})
const errors = new Set([
  'PHONE_VERIFICATION_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'PROFILE_CHANGED',
  'SELLER_CLOSED',
  'PLAN_READ_ONLY',
])
function failure(message: string): never {
  throw new Error(errors.has(message) ? message : 'REQUEST_FAILED')
}
export async function executeCentralShippingAddress(
  client: SupabaseClient,
  input: unknown,
) {
  const c = centralAddressCommand.parse(input)
  if (c.action === 'read') {
    const r = await client.rpc('read_my_central_shipping_address')
    if (r.error) failure(r.error.message)
    return z.object({ account: account.nullable() }).parse(r.data)
  }
  const r = await client.rpc('save_my_central_shipping_address', {
    p_id: c.requestId,
    p_tenant: c.tenantId,
    p_seller: c.sellerId,
    p_expected: c.expectedRevision,
    p_address: c.address,
  })
  if (r.error) failure(r.error.message)
  if (r.data !== c.requestId) throw new Error('REQUEST_FAILED')
  return { id: c.requestId }
}
