import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionStage } from './reception-queue'
import { itemStage } from './items'

const metric = z.object({
  count: z.number().int().nonnegative(),
  oldest: z.iso.datetime({ offset: true }).nullable(),
})
export type FlowMetric = z.infer<typeof metric>
export const flowSnapshot = z.object({
  asOf: z.iso.datetime({ offset: true }),
  dropoffs: metric,
  drafts: metric,
  reception: z.partialRecord(receptionStage, metric),
  inventory: z.partialRecord(itemStage, metric),
})
export type FlowSnapshot = z.infer<typeof flowSnapshot>
export async function readFlowSnapshot(
  client: SupabaseClient,
  tenantId: string,
) {
  const result = await client.rpc('store_flow_snapshot', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error) throw new Error('Unable to read flow snapshot')
  return flowSnapshot.parse(result.data)
}
