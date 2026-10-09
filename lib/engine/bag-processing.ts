import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const state = z.enum(['open', 'completed'])
export const bagProcessingState = z.object({
  state,
  version: z.number().int().nonnegative(),
  history: z
    .array(
      z.object({
        version: z.number().int().positive(),
        state,
        reason: z.string(),
        at: z.string(),
        actor: z.string(),
      }),
    )
    .max(20),
})
export type BagProcessingState = z.infer<typeof bagProcessingState>
export const setBagProcessingCommand = z
  .strictObject({
    action: z.literal('setBagProcessing'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    bagId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    state,
    reason: z.string().trim().max(500),
  })
  .refine((c) => c.state === 'completed' || c.reason.length > 0)

export async function readBagProcessing(
  client: SupabaseClient,
  tenant: string,
  bag: string,
) {
  const result = await client.rpc('bag_processing', {
    p_tenant: z.uuid().parse(tenant),
    p_bag: z.uuid().parse(bag),
  })
  if (result.error) throw new Error('Unable to read drop-off processing status')
  return bagProcessingState.parse(result.data)
}
