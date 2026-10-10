import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const agreementApproval = z.strictObject({
  agreementId: z.uuid(),
  reference: z.string().trim().min(1).max(500),
})
const acceptance = z.object({
  id: z.uuid(),
  at: z.string(),
  source: z.enum(['staff_recorded', 'seller_portal']),
  reference: z.string(),
})
const register = z.object({
  total: z.number().int().nonnegative(),
  sellers: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        email: z.string(),
        phone: z.string(),
        acceptance: acceptance.nullable(),
      }),
    )
    .max(25),
})
export async function readAgreementSellers(
  client: SupabaseClient,
  tenant: string,
  agreement: string,
  query: string,
  status: 'all' | 'accepted' | 'missing',
  page: number,
) {
  const result = await client.rpc('agreement_sellers', {
    p_tenant: z.uuid().parse(tenant),
    p_agreement: z.uuid().parse(agreement),
    p_query: z.string().max(120).parse(query),
    p_status: status,
    p_offset: (z.number().int().min(1).max(1000000).parse(page) - 1) * 25,
  })
  if (result.error) throw new Error('Unable to read agreement acceptances')
  return register.parse(result.data)
}
