import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { quickReceive } from '../../lib/engine/quick-intake'
import { quickReceiveResult } from '../../lib/intake/quick-receive-result'

const id = '40000000-0000-4000-8000-000000000001'
const accepted = {
  itemId: id,
  reference: 'I-40000000',
  sessionId: id,
  garmentId: id,
  reviewVersion: 3,
}
const command = {
  tenantId: id,
  requestId: id,
  sellerId: id,
  sessionId: id,
  expectedRevision: 0,
  facts: { description: 'Synthetic lamp' },
  priceOre: 12050,
}

function fixture(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: accepted, error: null }),
    from: vi.fn().mockReturnValue(query),
  }
  return {
    client: client as unknown as SupabaseClient,
    from: client.from,
    query,
  }
}

it('reads confirmation from the accepted review version within the same tenant and session', async () => {
  const f = fixture({
    suggestions: {
      price: {
        amount: '120.50',
        currency: 'NOK',
        rationale: 'Synthetic evidence',
      },
    },
  })
  const result = await quickReceive(f.client, command)
  expect(result.price).toEqual({ amount: '120.50', currency: 'NOK' })
  expect(f.from).toHaveBeenCalledWith('reception_reviews')
  expect(f.query.eq.mock.calls).toEqual([
    ['tenant_id', id],
    ['session_id', id],
    ['version', 3],
  ])
})

it('keeps confirmed acceptance without inventing a price when its extra read fails', async () => {
  const f = fixture(null, { message: 'Synthetic read failure' })
  await expect(quickReceive(f.client, command)).resolves.toEqual(accepted)
  f.query.single.mockRejectedValueOnce(new Error('Synthetic network failure'))
  await expect(quickReceive(f.client, command)).resolves.toEqual(accepted)
  f.query.single.mockResolvedValueOnce({
    data: { suggestions: { price: { amount: 'invalid' } } },
    error: null,
  })
  await expect(quickReceive(f.client, command)).resolves.toEqual(accepted)
})

it('accepts legacy confirmations without claiming a price and rejects damaged price data', () => {
  expect(quickReceiveResult.parse(accepted).price).toBeUndefined()
  for (const price of [
    { amount: 'wrong', currency: 'SEK' },
    { amount: '120.50', currency: 'invalid' },
    { amount: '0.00', currency: 'SEK' },
  ]) {
    expect(quickReceiveResult.safeParse({ ...accepted, price }).success).toBe(
      false,
    )
  }
})
