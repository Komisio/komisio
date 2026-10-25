import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSellersOverviewPage } from '../../lib/engine/sellers'
const tenant = '97000000-0000-4000-8000-000000000001'
it('keeps tenant and contact query on later pages', async () => {
  const data = { sellers: [], total: 53, limit: 25, offset: 50 }
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  expect(
    await readSellersOverviewPage(
      { rpc } as unknown as SupabaseClient,
      tenant,
      ' 070-123 ',
      50,
    ),
  ).toEqual(data)
  expect(rpc).toHaveBeenCalledWith('sellers_directory_page', {
    p_tenant: tenant,
    p_query: '070-123',
    p_offset: 50,
    p_limit: 25,
    p_sort: 'name',
    p_type: 'all',
    p_direction: 'asc',
  })
})
it('rejects invalid page bounds and never falls back on denied access', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { code: '42501' } })
  const client = { rpc } as unknown as SupabaseClient
  for (const offset of [-1, 0.5, 2147483648])
    await expect(
      readSellersOverviewPage(client, tenant, '', offset),
    ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
  await expect(readSellersOverviewPage(client, tenant, '')).rejects.toThrow(
    'FORBIDDEN',
  )
  rpc.mockResolvedValue({ error: { code: 'PGRST202' } })
  await expect(readSellersOverviewPage(client, tenant, '')).rejects.toThrow(
    'FORBIDDEN',
  )
})

it('passes validated sort and direction to the complete filtered read', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { sellers: [], total: 0, limit: 25, offset: 25 },
    error: null,
  })
  const client = { rpc } as unknown as SupabaseClient
  await readSellersOverviewPage(
    client,
    tenant,
    'match',
    25,
    25,
    'available',
    'desc',
  )
  expect(rpc).toHaveBeenCalledWith(
    'sellers_directory_page',
    expect.objectContaining({
      p_query: 'match',
      p_offset: 25,
      p_sort: 'available',
      p_direction: 'desc',
    }),
  )
})
