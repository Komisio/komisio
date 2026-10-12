import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const paypalSyncStatus = z.enum([
  'not_sent',
  'changed',
  'failed',
  'attention',
  'synced',
  'inactive',
])
export const paypalItemState = z.object({
  itemId: z.guid(),
  status: paypalSyncStatus,
  productStatus: z.enum(['synced', 'failed']).nullable(),
  productAt: z.string().nullable(),
  stockStatus: z
    .enum(['initialized', 'depleted', 'unknown', 'conflict'])
    .nullable(),
  stockAt: z.string().nullable(),
  imageStatus: z.enum(['synced', 'uploaded', 'held']).nullable(),
  errorCode: z.string().nullable(),
  canExport: z.boolean(),
  connected: z.boolean(),
})
export type PayPalItemState = z.infer<typeof paypalItemState>

/** A recorded observation, never a live provider inventory claim. */
export async function readPayPalItemStatus(
  client: SupabaseClient,
  tenantId: string,
  itemIds: string[],
) {
  const ids = z.array(z.guid()).max(50).parse(itemIds)
  if (!ids.length) return []
  const r = await client.rpc('paypal_item_status', {
    p_tenant: z.uuid().parse(tenantId),
    p_items: ids,
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('Unable to read PayPal POS status')
  return z.array(paypalItemState).max(50).parse(r.data)
}
