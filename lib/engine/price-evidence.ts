import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currencyCode } from './money'

// Price evidence (P3): comparable sales in the store itself, from the
// store's own facts. Evidence for a person or an agent to cite, never a
// price. Boundary validation only.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const priceEvidenceInput = z.strictObject({
  category: z.string().trim().max(120).default(''),
  query: z.string().trim().max(120).default(''),
  days: z.number().int().min(1).max(1095).default(365),
})
export const priceEvidence = z.object({
  currency: currencyCode,
  days: z.number().int(),
  category: z.string().nullable(),
  query: z.string().nullable(),
  summary: z.object({
    count: z.number().int(),
    medianSoldOre: ore.nullable(),
    minSoldOre: ore.nullable(),
    maxSoldOre: ore.nullable(),
    averageDaysToSale: z.number().int().nullable(),
  }),
  matches: z
    .array(
      z.object({
        itemId: z.guid(),
        title: z.string().nullable(),
        category: z.string().nullable(),
        acceptedPriceOre: ore.nullable(),
        soldPriceOre: ore,
        markdowns: z.number().int(),
        acceptedAt: z.iso.datetime({ offset: true }),
        soldAt: z.iso.datetime({ offset: true }),
        daysToSale: z.number().int(),
      }),
    )
    .max(20),
})
export type PriceEvidence = z.infer<typeof priceEvidence>

/** Sold items of this store matching a category and free text; RLS and role in SQL. */
export async function readPriceEvidence(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
) {
  const c = priceEvidenceInput.parse(input)
  const result = await client.rpc('price_evidence', {
    p_tenant: z.uuid().parse(tenantInput),
    p_category: c.category || null,
    p_query: c.query || null,
    p_days: c.days,
  })
  if (result.error) throw new Error('FORBIDDEN')
  return priceEvidence.parse(result.data)
}
