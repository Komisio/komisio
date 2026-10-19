import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readItemSellerChoices } from '../../lib/engine/item-filter-options'

const tenant = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'

it('reads only names and IDs from the requested tenant, including later pages', async () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, () => ({ id, name: 'Seller' })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id, name: 'Last seller' }],
        error: null,
      }),
  }
  const from = vi.fn(() => query)
  const result = await readItemSellerChoices(
    { from } as unknown as SupabaseClient,
    tenant,
  )
  expect(result).toHaveLength(501)
  expect(from.mock.calls).toEqual([['sellers'], ['sellers']])
  expect(query.select.mock.calls).toEqual([['id,name'], ['id,name']])
  expect(query.eq.mock.calls).toEqual([
    ['tenant_id', tenant],
    ['tenant_id', tenant],
  ])
  expect(query.range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
  ])
})

it('validates tenant IDs and fails closed on lookup errors', async () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'denied' } }),
  }
  const from = vi.fn(() => query)
  const client = { from } as unknown as SupabaseClient
  await expect(readItemSellerChoices(client, 'wrong')).rejects.toThrow()
  expect(from).not.toHaveBeenCalled()
  await expect(readItemSellerChoices(client, tenant)).rejects.toThrow(
    'Unable to read seller filter choices',
  )
})
