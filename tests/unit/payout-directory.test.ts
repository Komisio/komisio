import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPayoutsPage } from '../../lib/engine/payouts'

const tenant = '10000000-0000-4000-8000-000000000001'
function clientWith(results: unknown[]) {
  const queries: { filters: unknown[][]; range?: number[] }[] = []
  const from = vi.fn(() => {
    const record: { filters: unknown[][]; range?: number[] } = { filters: [] }
    queries.push(record)
    const result = results.shift()
    const chain = {
      select: (...args: unknown[]) => {
        record.filters.push(['select', ...args])
        return chain
      },
      eq: (...args: unknown[]) => {
        record.filters.push(['eq', ...args])
        return chain
      },
      in: (...args: unknown[]) => {
        record.filters.push(['in', ...args])
        return chain
      },
      order: (...args: unknown[]) => {
        record.filters.push(['order', ...args])
        return chain
      },
      range: (...args: number[]) => {
        record.range = args
        return chain
      },
      then: (resolve: (value: unknown) => void) =>
        Promise.resolve(result).then(resolve),
    }
    return chain
  })
  return { client: { from } as unknown as SupabaseClient, queries, from }
}
it('filters status and tenant before reading a later open-work page', async () => {
  const { client, queries } = clientWith([{ data: [], error: null, count: 26 }])
  expect(await readPayoutsPage(client, tenant, 'open', 2)).toEqual({
    rows: [],
    count: 26,
  })
  expect(queries[0].filters).toContainEqual(['eq', 'tenant_id', tenant])
  expect(queries[0].filters).toContainEqual([
    'in',
    'status',
    ['requested', 'approved'],
  ])
  expect(queries[0].filters).toContainEqual([
    'order',
    'requested_at',
    { ascending: true },
  ])
  expect(queries[0].range).toEqual([25, 49])
})
it('recovers a disappeared page using only the same scoped history count', async () => {
  const { client, queries } = clientWith([
    { data: null, error: { code: 'PGRST103' }, count: null },
    { data: null, error: null, count: 25 },
  ])
  expect(await readPayoutsPage(client, tenant, 'history', 2)).toEqual({
    rows: [],
    count: 25,
  })
  expect(queries).toHaveLength(2)
  for (const query of queries) {
    expect(query.filters).toContainEqual(['eq', 'tenant_id', tenant])
    expect(query.filters).toContainEqual(['in', 'status', ['paid', 'rejected']])
  }
})
it.each([
  [{ data: null, error: { code: '42501' }, count: null }],
  [
    { data: null, error: { code: 'PGRST103' }, count: null },
    { data: null, error: { code: '42501' }, count: null },
  ],
  [
    { data: null, error: { code: 'PGRST103' }, count: null },
    { data: null, error: null, count: 26 },
  ],
  [{ data: [], error: null, count: null }],
])(
  'does not turn read failures into an empty successful list',
  async (...results) => {
    const { client } = clientWith(results)
    await expect(readPayoutsPage(client, tenant, 'open', 2)).rejects.toThrow()
  },
)
it.each([0, -1, 1.5, 100001])(
  'rejects invalid page %s before querying',
  async (page) => {
    const { client, from } = clientWith([])
    await expect(
      readPayoutsPage(client, tenant, 'open', page),
    ).rejects.toThrow()
    expect(from).not.toHaveBeenCalled()
  },
)
