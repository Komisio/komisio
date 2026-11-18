import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parcelAddress, shippingContact } from './central-parcel-schema'

export const centralIntakeProfileCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read') }),
  z.strictObject({
    action: z.literal('save'),
    requestId: z.uuid(),
    tenantId: z.uuid(),
    agreementVersionId: z.uuid(),
    expectedRevision: z.number().int().min(-1).max(2147483646),
    address: parcelAddress,
    contact: shippingContact,
    acceptAgreement: z.boolean(),
  }),
])
export const centralIntakeProfile = z
  .object({
    tenantId: z.uuid(),
    agreement: z.object({
      id: z.uuid(),
      version: z.number().int().positive(),
      title: z.string(),
      body: z.string(),
      language: z.string(),
    }),
    agreementAccepted: z.boolean(),
    account: z
      .object({
        tenantId: z.uuid(),
        sellerId: z.uuid(),
        revision: z.number().int().nonnegative(),
        address: parcelAddress.nullable(),
        contact: shippingContact.nullable(),
      })
      .nullable(),
  })
  .refine((v) => v.account === null || v.account.tenantId === v.tenantId)
const errors = new Set([
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'PROFILE_CHANGED',
  'SELLER_CLOSED',
  'PLAN_READ_ONLY',
  'STORE_UNAVAILABLE',
  'AGREEMENT_REQUIRED',
  'AGREEMENT_CHANGED',
  'SHIPPING_CONTACT_UNSUPPORTED',
])
export async function executeCentralIntakeProfile(
  client: SupabaseClient,
  input: unknown,
) {
  const c = centralIntakeProfileCommand.parse(input)
  const r =
    c.action === 'read'
      ? await client.rpc('read_central_intake_profile')
      : await client.rpc('save_central_intake_profile', {
          p_id: c.requestId,
          p_tenant: c.tenantId,
          p_agreement: c.agreementVersionId,
          p_expected: c.expectedRevision,
          p_address: c.address,
          p_contact: c.contact,
          p_accept: c.acceptAgreement,
        })
  if (r.error)
    throw new Error(
      errors.has(r.error.message) ? r.error.message : 'REQUEST_FAILED',
    )
  if (c.action === 'read') return centralIntakeProfile.parse(r.data)
  if (r.data !== c.requestId) throw new Error('UNCONFIRMED_RESULT')
  return { id: c.requestId }
}
