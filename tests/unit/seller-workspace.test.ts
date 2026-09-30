import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSellerWorkspaceItems } from '../../lib/engine/seller-workspace'

const tenant = '11111111-1111-4111-8111-111111111111'
const seller = '22222222-2222-4222-8222-222222222222'
const item = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Synthetic sold item',
  category: '',
  stage: 'sold',
  acceptedAt: '2026-09-29T12:00:00Z',
  priceOre: '20000',
}

it('keeps sale and list amounts distinct while accepting pre-migration rows as unknown', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: {
        items: [{ ...item, soldPriceOre: '15000' }],
        total: 26,
        page: 1,
        limit: 25,
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { items: [item], total: 26, page: 1, limit: 25 },
      error: null,
    })
  const client = { rpc } as unknown as SupabaseClient
  const current = await readSellerWorkspaceItems(client, tenant, seller, 1)
  expect(current?.items[0]).toMatchObject({
    priceOre: 20000,
    soldPriceOre: 15000,
  })
  expect(rpc).toHaveBeenNthCalledWith(1, 'seller_workspace_items', {
    p_tenant: tenant,
    p_seller: seller,
    p_page: 1,
  })
  const legacy = await readSellerWorkspaceItems(client, tenant, seller, 1)
  expect(legacy?.items[0]).toMatchObject({
    priceOre: 20000,
    soldPriceOre: null,
  })
})

it('retains unavailable rollout and read-error behavior', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ error: { code: '42501' } })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readSellerWorkspaceItems(client, tenant, seller)).toBeNull()
  await expect(
    readSellerWorkspaceItems(client, tenant, seller),
  ).rejects.toThrow('Unable to read seller items')
})
