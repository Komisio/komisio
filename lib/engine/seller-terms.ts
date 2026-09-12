import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Per-seller commission terms (P1 S2). A null field means "use the store policy".
// Boundary validation only; SQL authorizes, versions and merges.
const percent = z.number().nonnegative().max(100).multipleOf(0.01)

export const publishSellerTermsCommand = z.strictObject({
  action: z.literal('publishSellerTerms'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sellerId: z.uuid(),
  expectedCurrentId: z.uuid().nullable(),
  commissionBasis: z.enum(['inclusive', 'exclusive']).nullable(),
  commissionRatePercent: percent.nullable(),
  notes: z.string().trim().max(500),
})

export const effectiveSellerTerms = z.strictObject({
  sellerTermsId: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  notes: z.string(),
  commissionBasis: z.enum(['inclusive', 'exclusive']),
  commissionRatePercent: percent,
  overrides: z.strictObject({
    commissionBasis: z.boolean(),
    commissionRatePercent: z.boolean(),
  }),
  storePolicyId: z.uuid().nullable(),
  storePolicyVersion: z.number().int().nonnegative(),
})
export type EffectiveSellerTerms = z.infer<typeof effectiveSellerTerms>

/** Policy merged with the seller's latest version; a read, not a frozen fact. */
export async function readEffectiveSellerTerms(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const result = await client.rpc('effective_seller_terms', {
    p_tenant: z.uuid().parse(tenantInput),
    p_seller: z.uuid().parse(sellerInput),
  })
  if (result.error) {
    if (result.error.message.includes('SELLER_NOT_FOUND'))
      throw new Error('SELLER_NOT_FOUND')
    throw new Error('FORBIDDEN')
  }
  return effectiveSellerTerms.parse(result.data)
}

const historyRow = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  commission_basis: z.enum(['inclusive', 'exclusive']).nullable(),
  commission_rate_percent: z.union([z.number(), z.string()]).nullable(),
  notes: z.string(),
  created_at: z.iso.datetime({ offset: true }),
})
/** Newest first; RLS scopes the read. */
export async function readSellerTermsHistory(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const { data, error } = await client
    .from('seller_terms_versions')
    .select(
      'id,version,commission_basis,commission_rate_percent,notes,created_at',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('seller_id', z.uuid().parse(sellerInput))
    .order('version', { ascending: false })
    .limit(20)
  if (error) throw new Error('Unable to read seller terms')
  return z
    .array(historyRow)
    .parse(data)
    .map((r) => ({
      ...r,
      commission_rate_percent:
        r.commission_rate_percent === null
          ? null
          : Number(r.commission_rate_percent),
    }))
}
