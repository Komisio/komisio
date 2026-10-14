import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
export const inventoryRowCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  itemId: z.guid(),
  expected: z.strictObject({
    title: z.string().max(1000),
    category: z.string().max(1000),
    version: z.number().int().nonnegative(),
  }),
  title: z.string().trim().min(1).max(1000),
  category: z.string().trim().max(1000),
  itemType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .nullable(),
  assortment: z.uuid().nullable(),
})
export async function editInventoryRow(client: SupabaseClient, input: unknown) {
  const c = inventoryRowCommand.parse(input)
  const r = await client.rpc('edit_inventory_row', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_item: c.itemId,
    p_expected: c.expected,
    p_title: c.title,
    p_category: c.category,
    p_type: c.itemType,
    p_group: c.assortment,
  })
  if (r.error)
    throw new Error(
      [
        'FORBIDDEN',
        'INVALID_INPUT',
        'ITEM_CHANGED',
        'REQUEST_CONFLICT',
        'ITEM_NOT_FOUND',
        'GROUP_NOT_FOUND',
        'ITEM_TYPE_UNDEFINED',
      ].find((code) => r.error!.message === code) ?? 'REQUEST_FAILED',
    )
  if (r.data !== c.requestId) throw new Error('REQUEST_FAILED')
  return { ok: true, id: c.requestId }
}
