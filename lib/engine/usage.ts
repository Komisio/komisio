import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Usage metering (P2 S20): SQL counts one unit per metered fact through
// triggers; this read returns the month's units per feature with the quota
// that applies. The page never adds numbers itself.
export const usageFeature = z.enum([
  'reception_assistance',
  'seller_email',
  'print_job',
])
export const usageRow = z.object({
  feature: usageFeature,
  units: z.coerce.number().int().nonnegative(),
  quota: z.coerce.number().int().nonnegative().nullable(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
})
export type UsageRow = z.infer<typeof usageRow>

export async function readUsageSummary(
  client: SupabaseClient,
  tenantInput: string,
  period?: string,
) {
  const { data, error } = await client.rpc('usage_summary', {
    p_tenant: z.uuid().parse(tenantInput),
    p_period: period ?? null,
  })
  if (error) throw new Error('Unable to read usage')
  return z.array(usageRow).max(10).parse(data)
}
