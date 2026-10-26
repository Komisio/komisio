import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { derivedId, quickReceive } from '../../lib/engine/quick-intake'

it('sends explicit category identity, including none, to the atomic reception command', async () => {
  const id = '40000000-0000-4000-8000-000000000001'
  const result = {
    itemId: id,
    sessionId: id,
    garmentId: id,
    reference: 'I-TEST',
    reviewVersion: 1,
  }
  for (const categoryId of [id, null]) {
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null })
    await quickReceive({ rpc } as unknown as SupabaseClient, {
      tenantId: id,
      requestId: id,
      sellerId: id,
      sessionId: id,
      expectedRevision: 0,
      facts: { description: 'Book' },
      priceOre: 10000,
      categoryId,
    })
    expect(rpc).toHaveBeenCalledWith(
      'quick_receive_categorized',
      expect.objectContaining({
        p_category: categoryId,
        p_group: null,
        p_bag: null,
        p_facts: { description: 'Book' },
      }),
    )
  }
})

it('derives RFC 4122 shaped ids that the readers accept, deterministically', () => {
  const a = derivedId('40000000-0000-4000-8000-000000000001', 'session')
  expect(a).toBe(derivedId('40000000-0000-4000-8000-000000000001', 'session'))
  expect(a).not.toBe(derivedId('40000000-0000-4000-8000-000000000001', 'item'))
  expect(z.uuid().safeParse(a).success).toBe(true)
  expect(a).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})
