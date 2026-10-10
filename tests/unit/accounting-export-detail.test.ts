import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFortnoxSends } from '../../lib/engine/fortnox-vouchers'
it('filters the exact tenant/export before applying the send-history limit', async () => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: [] }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  const client = {
    from: vi.fn().mockReturnValue(query),
  } as unknown as SupabaseClient
  const tenant = '10000000-0000-4000-8000-000000000001',
    id = '20000000-0000-4000-8000-000000000002'
  expect((await readFortnoxSends(client, tenant, id)).size).toBe(0)
  expect(query.eq.mock.calls).toEqual([
    ['tenant_id', tenant],
    ['export_id', id],
  ])
  expect(query.limit).toHaveBeenCalledWith(1)
  expect(query.eq.mock.invocationCallOrder[1]).toBeLessThan(
    query.limit.mock.invocationCallOrder[0],
  )
  await expect(readFortnoxSends(client, tenant, 'bad')).rejects.toThrow()
})
