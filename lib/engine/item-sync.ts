import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const syncProvider = z.enum(['paypal', 'shopify'])
export const itemSyncStatus = z.enum([
  'not_sent',
  'changed',
  'failed',
  'attention',
  'synced',
  'inactive',
])
export const itemSyncConnection = z.object({
  provider: syncProvider,
  connectionId: z.string().min(1).max(200),
  itemId: z.guid(),
  status: itemSyncStatus,
  productStatus: z.enum(['synced', 'failed', 'pending', 'unknown']).nullable(),
  productAt: z.string().nullable(),
  stockStatus: z
    .enum(['initialized', 'depleted', 'unknown', 'conflict'])
    .nullable(),
  stockAt: z.string().nullable(),
  imageStatus: z
    .enum([
      'synced',
      'uploaded',
      'held',
      'failed',
      'pending',
      'changed',
      'not_sent',
    ])
    .nullable(),
  errorCode: z.string().nullable(),
  canExport: z.boolean(),
  connected: z.boolean(),
})
export type ItemSyncConnection = z.infer<typeof itemSyncConnection>
export const itemSyncConnections = z.array(itemSyncConnection).max(20)

/** Tenant-bound recorded observations; never infer one provider from another. */
export async function readItemSyncStatus(
  client: SupabaseClient,
  tenantId: string,
  itemIds: string[],
) {
  const ids = z.array(z.guid()).max(50).parse(itemIds)
  if (!ids.length) return []
  const r = await client.rpc('item_sync_status', {
    p_tenant: z.uuid().parse(tenantId),
    p_items: ids,
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('Unable to read item synchronization status')
  return z
    .array(z.object({ itemId: z.guid(), connections: itemSyncConnections }))
    .max(50)
    .parse(r.data)
}
