import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readBagInventory } from '../../lib/engine/bag-inventory'
const tenant = '10000000-0000-4000-8000-000000000001',
  bag = '20000000-0000-4000-8000-000000000001'
it('uses bounded bag scope and sorting on the shared directory read', async () => {
  const data = { items: [], total: 26, limit: 25, offset: 25, currency: 'SEK' }
  const rpc = vi.fn().mockResolvedValue({ data })
  expect(
    await readBagInventory(
      { rpc } as unknown as SupabaseClient,
      tenant,
      bag,
      25,
      'title',
      'asc',
    ),
  ).toEqual(data)
  expect(rpc).toHaveBeenCalledWith('items_search_page', {
    p_tenant: tenant,
    p_filters: { bag },
    p_sort: 'title',
    p_direction: 'asc',
    p_limit: 25,
    p_offset: 25,
  })
})
it('never falls back to unscoped or incomplete rows on an unavailable read', async () => {
  for (const code of ['PGRST202', '42501']) {
    const rpc = vi.fn().mockResolvedValue({ error: { code } })
    await expect(
      readBagInventory({ rpc } as unknown as SupabaseClient, tenant, bag, 0),
    ).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(1)
  }
})
it('rejects missing bag identity and invalid page offsets before querying', async () => {
  const rpc = vi.fn()
  const client = { rpc } as unknown as SupabaseClient
  await expect(readBagInventory(client, tenant, '', 0)).rejects.toThrow()
  await expect(
    readBagInventory(client, tenant, undefined as unknown as string, 0),
  ).rejects.toThrow()
  for (const offset of [-25, 1, 24.5])
    await expect(
      readBagInventory(client, tenant, bag, offset),
    ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
