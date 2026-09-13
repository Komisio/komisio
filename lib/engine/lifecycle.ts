import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Lifecycle (P2 S20): the frozen sale period and markdown steps become a
// derived work list; three staff operations become events. Nothing runs by
// itself. Boundary validation only.
const ids = { tenantId: z.uuid(), requestId: z.uuid(), itemId: z.uuid() }
export const applyMarkdownCommand = z.strictObject({
  action: z.literal('applyMarkdown'),
  ...ids,
  step: z.number().int().min(1).max(20),
})
export const extendSalePeriodCommand = z.strictObject({
  action: z.literal('extendSalePeriod'),
  ...ids,
  days: z.number().int().min(1).max(365),
  reason: z.string().trim().min(1).max(500),
})
export const endSalePeriodCommand = z.strictObject({
  action: z.literal('endSalePeriod'),
  ...ids,
  endAction: z.enum(['charity', 'return']),
  note: z.string().trim().max(500).default(''),
})
export const lifecycleStage = z.enum([
  'on_sale',
  'markdown_due',
  'period_ending',
  'period_ended',
  'ended',
  'sold',
])
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const row = z.object({
  item_id: z.uuid(),
  seller_id: z.uuid().nullable(),
  ownership: z.enum(['consignment', 'store']),
  stage: lifecycleStage,
  accepted_at: z.iso.datetime({ offset: true }),
  period_end: z.iso.datetime({ offset: true }),
  current_price_ore: ore.nullable(),
  due_step: z.number().int().nullable(),
  due_percent: z.union([z.number(), z.string()]).nullable(),
  end_of_period_action: z.enum(['charity', 'return']).nullable(),
})
export type LifecycleRow = z.infer<typeof row>

/** Derived stages for every accepted item, oldest first; filter by stage. */
export async function readLifecycleQueue(
  client: SupabaseClient,
  tenantInput: string,
  stage?: string,
) {
  const { data, error } = await client.rpc('lifecycle_queue', {
    p_tenant: z.uuid().parse(tenantInput),
    p_stage: stage ? lifecycleStage.parse(stage) : null,
  })
  if (error) throw new Error('Unable to read lifecycle queue')
  return z.array(row).parse(data)
}
