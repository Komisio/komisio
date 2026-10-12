import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readItemSyncStatus } from '../../lib/engine/item-sync'
import { itemFilters } from '../../lib/engine/item-directory'

const tenant = '10000000-0000-4000-8000-000000000001'
const item = '20000000-0000-4000-8000-000000000001'
it('reads a bounded tenant/item set and keeps independent provider observations', async () => {
  const common = {
    itemId: item,
    productStatus: null,
    productAt: null,
    stockStatus: null,
    stockAt: null,
    imageStatus: null,
    errorCode: null,
    canExport: true,
    connected: true,
  }
  const data = [
    {
      itemId: item,
      connections: [
        {
          ...common,
          provider: 'paypal',
          connectionId: 'paypal',
          status: 'failed',
        },
        {
          ...common,
          provider: 'shopify',
          connectionId: 'shopify',
          status: 'synced',
        },
      ],
    },
  ]
  const rpc = vi.fn(async () => ({ data, error: null }))
  const client = { rpc } as unknown as SupabaseClient
  expect(await readItemSyncStatus(client, tenant, [item])).toEqual(data)
  expect(rpc).toHaveBeenCalledWith('item_sync_status', {
    p_tenant: tenant,
    p_items: [item],
  })
  await expect(
    readItemSyncStatus(client, tenant, Array(51).fill(item)),
  ).rejects.toThrow()
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('only treats a missing rollout RPC as unavailable; access errors fail closed', async () => {
  for (const code of ['PGRST202', '42501']) {
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: { code } })),
    } as unknown as SupabaseClient
    if (code === 'PGRST202')
      expect(await readItemSyncStatus(client, tenant, [item])).toBeNull()
    else
      await expect(readItemSyncStatus(client, tenant, [item])).rejects.toThrow()
  }
})
it('validates provider and status filters separately without inventing integrations', () => {
  expect(
    itemFilters.parse({ syncProvider: 'shopify', syncStatus: 'failed' }),
  ).toEqual({ syncProvider: 'shopify', syncStatus: 'failed' })
  expect(itemFilters.safeParse({ syncProvider: 'invented' }).success).toBe(
    false,
  )
  expect(itemFilters.safeParse({ syncStatus: 'invented' }).success).toBe(false)
})
