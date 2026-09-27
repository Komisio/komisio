import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Lifecycle (P2 S20): the frozen sale period and markdown steps become a
// derived work list; three staff operations become events. Nothing runs by
// itself. Boundary validation only.
const ids = { tenantId: z.uuid(), requestId: z.uuid(), itemId: z.guid() }
// Every due step in the store in one run (P3 markdown agent), as the caller.
export const applyDueMarkdownsCommand = z.strictObject({
  action: z.literal('applyDueMarkdowns'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
})
const runOre = z.union([z.number().int(), z.string()]).transform(Number)
const markdownRun = z.object({
  id: z.uuid(),
  mode: z.enum(['manual', 'automatic']),
  applied_count: z.number().int(),
  applied: z.array(
    z.object({
      itemId: z.guid(),
      step: z.number().int(),
      percent: z.union([z.number(), z.string()]).transform(Number),
      priceOre: runOre,
    }),
  ),
  created_at: z.iso.datetime({ offset: true }),
})
export type MarkdownRun = z.infer<typeof markdownRun>
/** Newest 20 runs, manual and automatic. RLS scopes the read. */
export async function readMarkdownRuns(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client
    .from('markdown_runs')
    .select('id,mode,applied_count,applied,created_at')
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error('Unable to read markdown runs')
  return z.array(markdownRun).parse(data)
}
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
// Transfer to another store in the chain (CHAIN-GROUPING step 2): ends the
// item here, receives a bag with one draft there. Owner or admin in both.
export const transferItemCommand = z.strictObject({
  action: z.literal('transferItem'),
  ...ids,
  toTenantId: z.uuid(),
  note: z.string().trim().max(500).default(''),
})
// Manual price set (P2 S20): a person's decision with a reason; the item stays on sale.
export const setItemPriceCommand = z.strictObject({
  action: z.literal('setItemPrice'),
  ...ids,
  priceOre: z.number().int().min(1).max(99_999_999_999),
  reason: z.string().trim().min(1).max(500),
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
  item_id: z.guid(),
  title: z.string().nullable().optional(),
  seller_id: z.guid().nullable(),
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
  const { data, error } = await client.rpc('lifecycle_queue_display', {
    p_tenant: z.uuid().parse(tenantInput),
    p_stage: stage ? lifecycleStage.parse(stage) : null,
  })
  if (error) throw new Error('Unable to read lifecycle queue')
  return z.array(row).parse(data)
}

// One page of the work list plus the matched total and the store-wide due
// count, which ignores the stage and text filters because the batch command
// is store-wide. Rows carry the same facts as the queue above.
const lifecyclePage = z.object({
  rows: z.array(row),
  total: z.number().int().nonnegative(),
  dueCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.literal(20),
})
export type LifecyclePage = z.infer<typeof lifecyclePage>

/** Null only while the paged function is not deployed; other errors throw. */
export async function readLifecycleQueuePage(
  client: SupabaseClient,
  tenantInput: string,
  options: { query?: string; stage?: string; offset?: number } = {},
): Promise<LifecyclePage | null> {
  const r = await client.rpc('lifecycle_queue_page', {
    p_tenant: z.uuid().parse(tenantInput),
    p_query: z
      .string()
      .trim()
      .max(120)
      .parse(options.query ?? ''),
    p_stage: options.stage ? lifecycleStage.parse(options.stage) : null,
    p_offset: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .parse(options.offset ?? 0),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('Unable to read lifecycle queue')
  return lifecyclePage.parse(r.data)
}
