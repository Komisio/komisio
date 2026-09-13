import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Returns (P2 S13): one full reversal per sale line as a new fact. SQL reverses
// the seller credit, frees the item and flags the return when the credit was
// already reserved or paid out. Boundary validation only.
export const recordReturnCommand = z.strictObject({
  action: z.literal('recordReturn'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  saleLineId: z.uuid(),
  // Exact decimal text; must equal the line price (full refund only in P2).
  refund: z.string().regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/),
  reason: z.string().trim().min(1).max(500),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
})
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const returnRow = z.object({
  id: z.uuid(),
  sale_line_id: z.uuid(),
  item_id: z.uuid(),
  refund_ore: ore,
  reason: z.string(),
  flagged_for_review: z.boolean(),
  flag_reason: z.string(),
  occurred_at: z.iso.datetime({ offset: true }),
})
export type SaleReturn = z.infer<typeof returnRow>
const columns =
  'id,sale_line_id,item_id,refund_ore,reason,flagged_for_review,flag_reason,occurred_at'

/** Returns for a set of sale lines, keyed by line id. */
export async function readReturnsForLines(
  client: SupabaseClient,
  tenantInput: string,
  lineIds: string[],
) {
  const ids = z.array(z.uuid()).max(50).parse(lineIds)
  if (!ids.length) return new Map<string, SaleReturn>()
  const { data, error } = await client
    .from('sale_returns')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .in('sale_line_id', ids)
  if (error) throw new Error('Unable to read returns')
  return new Map(
    z
      .array(returnRow)
      .parse(data)
      .map((r) => [r.sale_line_id, r]),
  )
}

/** Newest 50 returns flagged for review. */
export async function readFlaggedReturns(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client
    .from('sale_returns')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('flagged_for_review', true)
    .order('occurred_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read returns')
  return z.array(returnRow).parse(data)
}
