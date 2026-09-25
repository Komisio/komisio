import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readBagReceivedItems } from '../../lib/engine/bag-received-items'
const tenant = '10000000-0000-4000-8000-000000000001',
  bag = '20000000-0000-4000-8000-000000000001'
describe('bag received item rollout', () => {
  it('retains a capped legacy read only while the new RPC is missing', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: [] })
    expect(
      await readBagReceivedItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        25,
      ),
    ).toEqual({ items: [], total: 0, offset: 0, legacy: true })
    expect(rpc.mock.calls[1]).toEqual([
      'bag_received_items',
      { p_tenant: tenant, p_bag: bag },
    ])
  })
  it('never hides authorization or database errors behind legacy fallback', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: '42501' } })
    await expect(
      readBagReceivedItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        0,
      ),
    ).rejects.toThrow('Unable to read bag items')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves complete total and selected offset', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { items: [], total: 53, offset: 75 } })
    expect(
      await readBagReceivedItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        75,
      ),
    ).toEqual({ items: [], total: 53, offset: 75, legacy: false })
  })
})
