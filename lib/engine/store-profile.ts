import { z } from 'zod'
import { storeCountries } from '../platform/credit-prices'
import type { SupabaseClient } from '@supabase/supabase-js'

// Store profile (P3): the store's public-facing text as a versioned document.
// Boundary validation only; SQL validates again and keeps every version.
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
export const storeProfileBody = z.strictObject({
  address: z.strictObject({
    street: z.string().max(120),
    postalCode: z.string().max(20),
    city: z.string().max(120),
    country: z.enum(storeCountries).optional(),
  }),
  contact: z.strictObject({
    email: z.union([z.literal(''), z.email().max(254)]),
    phone: z.string().max(40),
    website: z.union([
      z.literal(''),
      z
        .string()
        .max(200)
        .regex(/^https:\/\/\S+$/),
    ]),
  }),
  openingHours: z
    .array(
      z
        .strictObject({ day: weekday, opens: clock, closes: clock })
        .refine((h) => h.opens < h.closes, 'opens before closes'),
    )
    .max(7)
    .refine(
      (list) => new Set(list.map((h) => h.day)).size === list.length,
      'each day once',
    ),
  accepts: z.string().max(2000),
  concept: z.string().max(2000),
  language: z.enum(['sv', 'en']),
})
export type StoreProfileBody = z.infer<typeof storeProfileBody>
export function emptyStoreProfile(language: 'sv' | 'en'): StoreProfileBody {
  return {
    address: { street: '', postalCode: '', city: '' },
    contact: { email: '', phone: '', website: '' },
    openingHours: [],
    accepts: '',
    concept: '',
    language,
  }
}
export const publishStoreProfileCommand = z.strictObject({
  action: z.literal('publishStoreProfile'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  expectedCurrentId: z.uuid().nullable(),
  profile: storeProfileBody,
})
const currentProfile = z.object({
  id: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  profile: storeProfileBody.nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
})
export type CurrentStoreProfile = z.infer<typeof currentProfile>

/** The member read: current version with its id, or version 0 and null. */
export async function readStoreProfile(
  client: SupabaseClient,
  tenantInput: string,
) {
  const result = await client.rpc('current_store_profile', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (result.error) throw new Error('FORBIDDEN')
  return currentProfile.parse(result.data)
}

const publicProfile = z
  .object({
    name: z.string(),
    slug: z.string(),
    version: z.number().int().positive(),
    profile: storeProfileBody,
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .nullable()

/** The public read by slug; null when the store has no profile. */
export async function readPublicStoreProfile(
  client: SupabaseClient,
  slugInput: string,
) {
  const result = await client.rpc('public_store_profile', {
    p_slug: z.string().min(1).max(100).parse(slugInput),
  })
  if (result.error) throw new Error('REQUEST_FAILED')
  return publicProfile.parse(result.data)
}
