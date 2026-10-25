import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { directoryOrder } from '../../lib/intake/directory-order'
import { readAgreementSellers } from '../../lib/engine/agreement-workspace'
it('normalizes unknown or repeated URL fields without allowing arbitrary ordering', () => {
  for (const value of [
    undefined,
    ['name:desc'],
    'date:desc',
    'name:asc:extra',
    'name:bad',
  ])
    expect(directoryOrder(['name', 'items'] as const, value)).toEqual({
      sort: 'name',
      direction: 'asc',
      value: 'name:asc',
    })
  expect(directoryOrder(['name', 'items'] as const, 'items:desc')).toEqual({
    sort: 'items',
    direction: 'desc',
    value: 'items:desc',
  })
})
it('binds sorted acceptance reads to exact tenant, version, status and page', async () => {
  const id = '30100000-0000-4000-8000-000000000001'
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { total: 0, sellers: [] }, error: null })
  await readAgreementSellers(
    { rpc } as unknown as SupabaseClient,
    id,
    id,
    'contact',
    'missing',
    3,
    'date',
    'desc',
  )
  expect(rpc).toHaveBeenCalledExactlyOnceWith('agreement_sellers_sorted', {
    p_tenant: id,
    p_agreement: id,
    p_query: 'contact',
    p_status: 'missing',
    p_offset: 50,
    p_sort: 'date',
    p_direction: 'desc',
  })
  rpc.mockResolvedValue({ error: { code: '42501' } })
  await expect(
    readAgreementSellers(
      { rpc } as unknown as SupabaseClient,
      id,
      id,
      '',
      'all',
      1,
    ),
  ).rejects.toThrow()
})
