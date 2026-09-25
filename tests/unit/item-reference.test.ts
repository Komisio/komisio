import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readItemReference } from '../../lib/engine/item-reference'
const tenant = '10000000-0000-4000-8000-000000000001'
const id = 'abcdef12-c0de-ac1c-046a-28d24816abec'
function fixture(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => ({ data, error })),
  }
  for (const name of ['select', 'eq', 'gte', 'lte', 'order'] as const)
    query[name].mockReturnValue(query)
  const from = vi.fn(() => query)
  return { client: { from } as unknown as SupabaseClient, from, query }
}
describe('item label resolution', () => {
  it('bounds the active tenant prefix read and accepts legacy UUID shapes', async () => {
    const f = fixture([{ id }])
    expect(await readItemReference(f.client, tenant, '  iAbCdEf12  ')).toEqual([
      id,
    ])
    expect(f.from).toHaveBeenCalledWith('items')
    expect(f.query.eq).toHaveBeenCalledWith('tenant_id', tenant)
    expect(f.query.gte).toHaveBeenCalledWith(
      'id',
      'abcdef12-0000-0000-0000-000000000000',
    )
    expect(f.query.lte).toHaveBeenCalledWith(
      'id',
      'abcdef12-ffff-ffff-ffff-ffffffffffff',
    )
    expect(f.query.limit).toHaveBeenCalledWith(2)
  })
  it.each(['K-12', 'I-1234', 'I-abcdefgh', 'I-123456789', 'I-12345678%'])(
    'does not query for invalid reference %s',
    async (ref) => {
      const f = fixture([])
      expect(await readItemReference(f.client, tenant, ref)).toEqual([])
      expect(f.from).not.toHaveBeenCalled()
    },
  )
  it('keeps ambiguous matches instead of choosing the first', async () => {
    const second = 'abcdef12-0000-4000-8000-000000000002',
      f = fixture([{ id }, { id: second }])
    expect(await readItemReference(f.client, tenant, 'I-ABCDEF12')).toEqual([
      id,
      second,
    ])
  })
  it('distinguishes read failure from a missing item', async () => {
    const f = fixture(null, { code: '42501' })
    await expect(
      readItemReference(f.client, tenant, 'I-ABCDEF12'),
    ).rejects.toThrow('Unable to resolve')
    expect(
      await readItemReference(fixture([]).client, tenant, 'I-ABCDEF12'),
    ).toEqual([])
  })
})
