import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPayPalItemStatus } from '../../lib/engine/paypal-status'
import { itemFilters } from '../../lib/engine/item-directory'
const tenant = '10000000-0000-4000-8000-000000000001'
const item = '20000000-0000-4000-8000-000000000001'

it('batches the exact tenant and item identifiers and never reads an unrestricted status list', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
  await expect(
    readPayPalItemStatus({ rpc } as unknown as SupabaseClient, tenant, [item]),
  ).resolves.toEqual([])
  expect(rpc).toHaveBeenCalledWith('paypal_item_status', {
    p_tenant: tenant,
    p_items: [item],
  })
  await readPayPalItemStatus({ rpc } as unknown as SupabaseClient, tenant, [])
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('only treats the missing additive RPC as a deployment gap', async () => {
  const client = (code: string) =>
    ({
      rpc: vi.fn().mockResolvedValue({ error: { code } }),
    }) as unknown as SupabaseClient
  await expect(
    readPayPalItemStatus(client('PGRST202'), tenant, [item]),
  ).resolves.toBeNull()
  await expect(
    readPayPalItemStatus(client('42501'), tenant, [item]),
  ).rejects.toThrow('Unable to read')
})
it('bounds reads and rejects unknown POS filters instead of silently dropping them', async () => {
  const rpc = vi.fn()
  await expect(
    readPayPalItemStatus(
      { rpc } as unknown as SupabaseClient,
      tenant,
      Array(51).fill(item),
    ),
  ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
  expect(
    itemFilters.safeParse({ paypal: 'synced', ownership: 'store' }).success,
  ).toBe(true)
  expect(itemFilters.safeParse({ paypal: 'anything' }).success).toBe(false)
})
