import { expect, it, vi } from 'vitest'
import {
  externalRequestFilters,
  externalRequestHref,
} from '../../lib/platform/external-request-filters'
import { readExternalOfferQueue } from '../../lib/engine/external-item-offers'
import type { SupabaseClient } from '@supabase/supabase-js'

it('normalizes unknown filters and preserves literal search text in paging links', () => {
  expect(
    externalRequestFilters({ status: 'other', q: '  Klänning  ' }),
  ).toEqual({ status: 'all', query: 'Klänning' })
  const filters = externalRequestFilters({ status: 'offered', q: '100% & blå' })
  const url = new URL(externalRequestHref(filters, 2), 'https://example.test')
  expect(url.searchParams.get('q')).toBe('100% & blå')
  expect(url.searchParams.get('status')).toBe('offered')
  expect(url.searchParams.get('page')).toBe('2')
  expect(externalRequestHref(filters)).not.toContain('page=')
  expect(externalRequestFilters({ q: 'a'.repeat(150) }).query).toHaveLength(120)
  expect(
    externalRequestFilters({ q: ['a', 'b'], status: ['offered'] }),
  ).toEqual({ status: 'all', query: '' })
})

it('sends status and text to the scoped read before pagination, never filters one loaded page', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { rows: [], total: 31 }, error: null })
  const client = { rpc } as unknown as SupabaseClient
  const tenant = 'f7900000-0000-4000-8000-000000000001'
  expect(
    await readExternalOfferQueue(client, tenant, 2, {
      status: 'waiting',
      query: 'jacka',
    }),
  ).toEqual({ rows: [], total: 31 })
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'external_item_offer_queue_filtered',
    {
      p_tenant: tenant,
      p_offset: 25,
      p_status: 'waiting',
      p_query: 'jacka',
    },
  )
})
