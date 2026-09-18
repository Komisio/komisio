import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'

export const sellerProfileBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    email: z.union([z.literal(''), z.email().max(254)]),
    phone: z.string().trim().max(40),
    addressLine1: z.string().trim().max(160),
    addressLine2: z.string().trim().max(160),
    postalCode: z.string().trim().max(24),
    city: z.string().trim().max(120),
    country: z.string().trim().max(80),
    language: z.union([z.literal(''), z.enum(locales)]),
    notes: z.string().trim().max(1000),
  })
  .refine((p) => p.email !== '' || p.phone !== '', 'Contact required')
export type SellerProfile = z.infer<typeof sellerProfileBody>
export const saveSellerProfileCommand = z.strictObject({
  action: z.literal('saveSellerProfile'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sellerId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  profile: sellerProfileBody,
})
export function initialSellerProfile(seller: {
  name: string
  email: string
  phone: string
}): SellerProfile {
  return {
    name: seller.name,
    email: seller.email,
    phone: seller.phone,
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: '',
    language: '',
    notes: '',
  }
}
/** Legacy statements use the immutable original contact after a correction. */
export async function readStatementSellerContact(
  client: SupabaseClient,
  tenantId: string,
  sellerId: string,
) {
  const result = await client.rpc('legacy_statement_seller_contact', {
    p_tenant: z.uuid().parse(tenantId),
    p_seller: z.uuid().parse(sellerId),
  })
  if (result.error) throw new Error('Unable to read statement contact')
  return z
    .object({ name: z.string(), email: z.string(), phone: z.string() })
    .parse(result.data)
}
