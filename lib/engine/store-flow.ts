import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const flowStepIds = [
  'arrive',
  'receive',
  'wait',
  'register',
  'review',
  'label',
  'sell',
  'unsold',
  'payout',
] as const
export type FlowStepId = (typeof flowStepIds)[number]
export const flowNotes = z.partialRecord(
  z.enum(flowStepIds),
  z.string().max(2000),
)
export const flowDocument = z.object({
  revision: z.number().int().nonnegative(),
  notes: flowNotes,
})
export type FlowDocument = z.infer<typeof flowDocument>
export const saveFlowCommand = z.strictObject({
  tenantId: z.uuid(),
  revision: z.number().int().nonnegative(),
  notes: flowNotes,
})
export async function readStoreFlow(client: SupabaseClient, tenant: string) {
  const result = await client.rpc('read_store_flow', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (result.error) throw new Error('FORBIDDEN')
  return flowDocument.parse(result.data)
}
export async function saveStoreFlow(client: SupabaseClient, input: unknown) {
  const command = saveFlowCommand.parse(input)
  return client.rpc('save_store_flow', {
    p_tenant: command.tenantId,
    p_revision: command.revision,
    p_notes: command.notes,
  })
}
