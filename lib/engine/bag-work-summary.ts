import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
const summary = z.object({
  accepted: z.number().int().nonnegative(),
  drafts: z.number().int().nonnegative(),
  receptions: z.number().int().nonnegative(),
  nextDraft: z.uuid().nullable(),
  nextReception: z.uuid().nullable(),
})
export async function readBagWorkSummary(
  client: SupabaseClient,
  tenant: string,
  bag: string,
) {
  const result = await client.rpc('bag_work_summary', {
    p_tenant: z.uuid().parse(tenant),
    p_bag: z.uuid().parse(bag),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('Unable to read handover progress')
  return summary.parse(result.data)
}
