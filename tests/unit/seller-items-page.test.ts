import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readMyItemsPage } from '../../lib/engine/seller-items'
const tenant = '97000000-0000-4000-8000-000000000001',
  seller = '97000000-0000-4000-8000-000000000002'
it('only treats a missing read as a rolling-deployment fallback', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ error: { code: '42501' } })
    .mockResolvedValueOnce({ error: { code: '57014' } })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readMyItemsPage(client, tenant, seller)).toBeNull()
  await expect(readMyItemsPage(client, tenant, seller)).rejects.toThrow(
    'Unable to read seller items',
  )
  await expect(readMyItemsPage(client, tenant, seller)).rejects.toThrow(
    'Unable to read seller items',
  )
})
it('rejects malformed scopes and offsets without making a read', async () => {
  const rpc = vi.fn(),
    client = { rpc } as unknown as SupabaseClient
  for (const offset of [-1, 0.5, 2147483648, NaN])
    await expect(
      readMyItemsPage(client, tenant, seller, { offset }),
    ).rejects.toThrow()
  await expect(readMyItemsPage(client, 'invalid', seller)).rejects.toThrow()
  await expect(readMyItemsPage(client, tenant, 'invalid')).rejects.toThrow()
  await expect(
    readMyItemsPage(client, tenant, seller, { query: 'x'.repeat(121) }),
  ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
it('keeps the complete total even when a page is empty', async () => {
  const data = {
    currency: 'SEK',
    automaticMarkdowns: false,
    items: [],
    total: 203,
    offset: 250,
  }
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  expect(
    await readMyItemsPage(
      { rpc } as unknown as SupabaseClient,
      tenant,
      seller,
      { query: ' Coat ', offset: 250 },
    ),
  ).toEqual(data)
  expect(rpc).toHaveBeenCalledWith('my_items_page', {
    p_tenant: tenant,
    p_seller: seller,
    p_query: 'Coat',
    p_status: 'all',
    p_offset: 250,
  })
})

it('validates status before the RPC and forwards the selected group', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { currency: 'SEK', items: [], total: 0, offset: 0 },
    error: null,
  })
  const client = { rpc } as unknown as SupabaseClient
  await expect(
    readMyItemsPage(client, tenant, seller, { status: 'invalid' as 'active' }),
  ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
  await readMyItemsPage(client, tenant, seller, {
    status: 'sold',
    query: 'Chair',
    offset: 25,
  })
  expect(rpc).toHaveBeenCalledWith('my_items_page', {
    p_tenant: tenant,
    p_seller: seller,
    p_query: 'Chair',
    p_offset: 25,
    p_status: 'sold',
  })
})
