import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bankDetails } from './seller-bank'

const uuid = z.uuid().transform((v) => v.toLowerCase())
export const externalOnboardingCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read'), offerId: uuid }),
  z.strictObject({
    action: z.literal('complete'),
    requestId: uuid,
    offerId: uuid,
    agreementVersionId: uuid,
    profile: z
      .strictObject({
        name: z.string().trim().min(1).max(120),
        email: z.email().trim().max(254).toLowerCase(),
      })
      .nullable(),
    bank: bankDetails
      .refine(
        (b) =>
          b.country === 'SE' &&
          b.kind === 'local' &&
          b.routing.trim().length > 0,
      )
      .nullable(),
  }),
])
export const externalOnboarding = z.object({
  offerId: uuid,
  tenantId: uuid,
  phone: z.string().min(1).max(40),
  store: z.object({
    address: z
      .object({
        street: z.string(),
        postalCode: z.string(),
        city: z.string(),
        country: z.string().optional(),
      })
      .nullable(),
    openingHours: z
      .array(
        z.object({
          day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
          opens: z.string(),
          closes: z.string(),
        }),
      )
      .max(7),
  }),
  account: z
    .object({
      id: uuid,
      name: z.string(),
      email: z.string(),
      hasBank: z.boolean(),
    })
    .nullable(),
  handover: z
    .object({
      id: uuid,
      reference: z.string().regex(/^H-[1-9]\d{0,11}$/),
      status: z.enum(['open', 'received', 'cancelled']),
      receivedAt: z.string().nullable(),
      itemCount: z.number().int().min(1).max(10),
      items: z
        .array(
          z.object({
            requestId: uuid,
            offerId: uuid,
            description: z.string(),
            brand: z.string(),
            photoId: uuid,
          }),
        )
        .min(1)
        .max(10),
    })
    .refine((h) => h.itemCount === h.items.length)
    .nullable(),
})
export async function executeExternalOnboarding(
  client: SupabaseClient,
  input: unknown,
) {
  const c = externalOnboardingCommand.parse(input)
  const r =
    c.action === 'read'
      ? await client.rpc('read_external_item_onboarding', {
          p_offer: c.offerId,
        })
      : await client.rpc('complete_external_item_offer', {
          p_id: c.requestId,
          p_offer: c.offerId,
          p_agreement: c.agreementVersionId,
          p_profile: c.profile,
          p_bank: c.bank,
        })
  if (r.error)
    throw new Error(
      [
        'PHONE_VERIFICATION_REQUIRED',
        'FORBIDDEN',
        'SUPPORT_READ_ONLY',
        'INVALID_INPUT',
        'REQUEST_CONFLICT',
        'REQUEST_CHANGED',
        'OFFER_NOT_FOUND',
        'OFFER_EXPIRED',
        'AGREEMENT_CHANGED',
        'SELLER_CLOSED',
        'ACCOUNT_REQUIRED',
        'PLAN_READ_ONLY',
      ].includes(r.error.message)
        ? r.error.message
        : 'REQUEST_FAILED',
    )
  if (c.action === 'read') {
    const result = externalOnboarding.parse(r.data)
    if (result.offerId !== c.offerId) throw new Error('REQUEST_FAILED')
    return result
  }
  if (r.data !== c.requestId) throw new Error('REQUEST_FAILED')
  return { id: c.requestId }
}
