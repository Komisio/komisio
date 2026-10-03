import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSellerCommunicationHistory } from '../../lib/engine/communications'

const tenant = '11111111-1111-4111-8111-111111111111'
const seller = '22222222-2222-4222-8222-222222222222'

it('recovers only an out-of-range page using a fresh scoped count', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.range.mockResolvedValue({
    data: null,
    count: null,
    error: { code: 'PGRST103' },
  })
  const head = { select: vi.fn(), eq: vi.fn() }
  head.select.mockReturnValue(head)
  head.eq
    .mockReturnValueOnce(head)
    .mockResolvedValueOnce({ count: 49, error: null })
  const from = vi.fn().mockReturnValueOnce(query).mockReturnValueOnce(head)
  const result = await readSellerCommunicationHistory(
    { from } as unknown as SupabaseClient,
    tenant,
    seller,
    999,
  )
  expect(head.select).toHaveBeenCalledWith('id', { head: true, count: 'exact' })
  expect(head.eq.mock.calls).toEqual([
    ['tenant_id', tenant],
    ['seller_id', seller],
  ])
  expect(result).toEqual({ items: [], total: 49, page: 999, limit: 25 })
})

it('reads past the old fifty-message boundary with both count and rows scoped to the seller and store', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.range.mockResolvedValue({ data: [], count: 101, error: null })
  const from = vi.fn().mockReturnValue(query)
  const result = await readSellerCommunicationHistory(
    { from } as unknown as SupabaseClient,
    tenant,
    seller,
    2,
  )
  expect(from).toHaveBeenCalledWith('seller_communications')
  expect(query.select).toHaveBeenCalledWith(expect.any(String), {
    count: 'exact',
  })
  expect(query.eq.mock.calls).toEqual([
    ['tenant_id', tenant],
    ['seller_id', seller],
  ])
  expect(query.order.mock.calls).toEqual([
    ['queued_at', { ascending: false }],
    ['id'],
  ])
  expect(query.range).toHaveBeenCalledWith(50, 74)
  expect(result).toEqual({ items: [], total: 101, page: 2, limit: 25 })
})

it('refuses invalid scopes and pages before issuing a read and never converts read failure into empty history', async () => {
  const from = vi.fn()
  const client = { from } as unknown as SupabaseClient
  for (const args of [
    ['invalid', seller, 0],
    [tenant, 'invalid', 0],
    [tenant, seller, -1],
    [tenant, seller, 0.5],
    [tenant, seller, 1000001],
  ] as const)
    await expect(
      readSellerCommunicationHistory(client, args[0], args[1], args[2]),
    ).rejects.toThrow()
  expect(from).not.toHaveBeenCalled()
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.range.mockResolvedValue({
    data: null,
    count: null,
    error: { message: 'read failed' },
  })
  from.mockReturnValue(query)
  await expect(
    readSellerCommunicationHistory(client, tenant, seller),
  ).rejects.toThrow('Unable to read communication history')
})
