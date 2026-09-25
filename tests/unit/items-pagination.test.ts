import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readItemsOverviewPage } from '../../lib/engine/items'
const tenant = '97000000-0000-4000-8000-000000000001'
const response = {
  currency: 'SEK',
  items: [],
  total: 55,
  limit: 25,
  offset: 50,
  query: 'coat',
  stage: 'on_sale',
}
it('passes the requested page and filters to the tenant-bound read', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: response, error: null })
  expect(
    await readItemsOverviewPage({ rpc } as unknown as SupabaseClient, tenant, {
      query: ' coat ',
      stage: 'on_sale',
      offset: 50,
    }),
  ).toEqual(response)
  expect(rpc).toHaveBeenCalledWith('items_overview_page', {
    p_tenant: tenant,
    p_query: 'coat',
    p_stage: 'on_sale',
    p_limit: 25,
    p_offset: 50,
  })
})
it('rejects invalid offsets before contacting the database', async () => {
  const rpc = vi.fn()
  for (const offset of [-1, 0.5, 2147483648, NaN])
    await expect(
      readItemsOverviewPage({ rpc } as unknown as SupabaseClient, tenant, {
        offset,
      }),
    ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
it('falls back only for a missing migration, never for denied access', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ error: { code: '42501' } })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readItemsOverviewPage(client, tenant)).toBeNull()
  await expect(readItemsOverviewPage(client, tenant)).rejects.toThrow(
    'FORBIDDEN',
  )
})
