import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Sellers list (P3 surface): the store's sellers with what it holds for
// them and their balance facts, computed in SQL. Read only; any member.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const sellersOverview = z.object({
  sellers: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        contact: z.string().nullable(),
        email: z.string().default(''),
        phone: z.string().default(''),
        city: z.string().default(''),
        createdAt: z.string(),
        itemsTotal: z.number().int(),
        itemsSold: z.number().int(),
        availableOre: ore,
        reservedOre: ore,
        creditedOre: ore,
      }),
    )
    .max(100),
  total: z.number().int(),
  limit: z.number().int(),
})
export type SellersOverview = z.infer<typeof sellersOverview>

export async function readSellersOverview(
  client: SupabaseClient,
  tenantInput: string,
  query: string,
  limit = 50,
) {
  const r = await client.rpc('sellers_overview', {
    p_tenant: z.uuid().parse(tenantInput),
    p_query: query.trim().slice(0, 120),
    p_limit: limit,
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return sellersOverview.parse(r.data)
}

// Duplicate check at registration: sellers already recorded with the same
// e-mail, phone number or name. Advisory; the person decides.
export const sellerMatches = z.object({
  matches: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        contact: z.string().nullable(),
        reasons: z.array(z.enum(['email', 'phone', 'name'])),
      }),
    )
    .max(5),
})
export type SellerMatches = z.infer<typeof sellerMatches>

export async function readSellerMatches(
  client: SupabaseClient,
  tenantInput: string,
  input: { name: string; email: string; phone: string },
): Promise<SellerMatches> {
  const r = await client.rpc('seller_matches', {
    p_tenant: z.uuid().parse(tenantInput),
    p_name: input.name.trim().slice(0, 120),
    p_email: input.email.trim().slice(0, 254),
    p_phone: input.phone.trim().slice(0, 40),
  })
  // Until the migration reaches the database the check finds nothing.
  if (r.error?.code === 'PGRST202') return { matches: [] }
  if (r.error) throw new Error('FORBIDDEN')
  return sellerMatches.parse(r.data)
}
