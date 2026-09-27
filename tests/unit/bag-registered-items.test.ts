import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readBagRegisteredItems } from '../../lib/engine/bag-registered-items'
const tenant = '10000000-0000-4000-8000-000000000001',
  bag = '20000000-0000-4000-8000-000000000001'
describe('unified handover item boundary', () => {
  it('accepts inspection items without a reception session or photo', async () => {
    const data = {
      items: [
        {
          id: bag,
          session_id: null,
          photo_id: null,
          title: 'Draft chair',
          price_ore: '12345',
        },
      ],
      total: 30,
      offset: 25,
    }
    const rpc = vi.fn().mockResolvedValue({ data })
    expect(
      await readBagRegisteredItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        25,
      ),
    ).toEqual({
      ...data,
      items: data.items.map((item) => ({
        ...item,
        stage: null,
        sold_price_ore: null,
      })),
      legacy: false,
      scope: 'all',
    })
  })
  it('labels a rollout fallback as quick-only rather than claiming a complete list', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: { items: [], total: 9, offset: 0 } })
    expect(
      await readBagRegisteredItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        0,
      ),
    ).toEqual({ items: [], total: 9, offset: 0, legacy: false, scope: 'quick' })
    expect(rpc.mock.calls[1][0]).toBe('bag_received_items_page')
  })
  it('does not invent lifecycle facts for a nonempty legacy row', async () => {
    const oldItem = {
      id: bag,
      session_id: bag,
      photo_id: null,
      title: 'Legacy chair',
      price_ore: '20000',
    }
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({
        data: { items: [oldItem], total: 1, offset: 0 },
      })
    const result = await readBagRegisteredItems(
      { rpc } as unknown as SupabaseClient,
      tenant,
      bag,
      0,
    )
    expect(result.items).toEqual([
      { ...oldItem, stage: null, sold_price_ore: null },
    ])
  })
  it('preserves capped fallback when both newer RPCs are unavailable', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: [] })
    expect(
      await readBagRegisteredItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        25,
      ),
    ).toEqual({ items: [], total: 0, offset: 0, legacy: true, scope: 'quick' })
  })
  it('keeps sale proceeds separate from the current list price', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: bag,
            session_id: null,
            photo_id: null,
            title: 'Sold chair',
            price_ore: '15000',
            stage: 'sold',
            sold_price_ore: '12000',
          },
        ],
        total: 1,
        offset: 0,
      },
    })
    const result = await readBagRegisteredItems(
      { rpc } as unknown as SupabaseClient,
      tenant,
      bag,
      0,
    )
    expect(result.items[0]).toMatchObject({
      stage: 'sold',
      price_ore: '15000',
      sold_price_ore: '12000',
    })
  })
  it('rejects unknown lifecycle facts rather than labelling them on sale', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: bag,
            session_id: null,
            photo_id: null,
            title: 'Chair',
            price_ore: '15000',
            stage: 'invented',
          },
        ],
        total: 1,
        offset: 0,
      },
    })
    await expect(
      readBagRegisteredItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        0,
      ),
    ).rejects.toThrow()
  })
  it('does not use fallback to hide access errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: '42501' } })
    await expect(
      readBagRegisteredItems(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
        0,
      ),
    ).rejects.toThrow('Unable to read registered handover items')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
