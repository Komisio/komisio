import { beforeEach, describe, expect, it } from 'vitest'
import {
  detailFromOrigin,
  isStaffDetailHref,
  staffReturnHref,
  sameStaffView,
} from '@/lib/platform/return-navigation'
import {
  clearReturnPositions,
  rememberReturnPosition,
  requestReturnPosition,
  takeReturnPosition,
} from '@/lib/platform/return-scroll'
const id = '020a4d6b-ad3a-4ecb-be97-a45e7057402d'
const item = `/intake/items/${id}`
describe('staff detail origins', () => {
  it('records only the originating view, never a detail paging position', () => {
    expect(
      sameStaffView(
        '/intake/items?q=blue%20coat#inventory-item-' + id,
        '/intake/items?q=blue+coat',
      ),
    ).toBe(true)
    expect(
      sameStaffView(
        '/intake/payouts?page=2',
        `/intake/sellers/${id}?returnTo=%2Fintake%2Fpayouts%3Fpage%3D2`,
      ),
    ).toBe(false)
    expect(sameStaffView('/intake/items?page=1', '/intake/items?page=2')).toBe(
      false,
    )
  })
  it.each([
    'lifecycle',
    'sales',
    'stocktake',
    'submissions',
    'payouts',
    'purchases',
    'operations',
    'pricing',
    'stock',
    'sellers',
    'items',
  ])('retains filters from %s', (list) => {
    const origin = `/intake/${list}?q=Blue+coat&page=3&sort=title`
    const href = new URL(
      detailFromOrigin(item, origin),
      'https://komisio.invalid',
    )
    expect(href.pathname).toBe(item)
    expect(staffReturnHref(href.searchParams.get('returnTo'))).toBe(origin)
  })
  it('retains nested detail origins and the selected tab', () => {
    const sale = detailFromOrigin(
      `/intake/sales/${id}`,
      '/intake/sales?reference=R#sales-register',
    )
    const nested = new URL(
      detailFromOrigin(item, sale),
      'https://komisio.invalid',
    )
    expect(staffReturnHref(nested.searchParams.get('returnTo'))).toBe(sale)
    expect(
      new URL(sale, 'https://komisio.invalid').searchParams.get('returnTo'),
    ).toBe('/intake/sales?reference=R#sales-register')
  })
  it('preserves explicit origins and carries the original through detail paging', () => {
    const source = `/intake/sellers/${id}?returnTo=${encodeURIComponent('/intake/payouts?page=2#payouts-history')}`
    expect(
      new URL(
        detailFromOrigin(
          `/intake/sellers/${id}?ledgerPage=1#seller-economy`,
          source,
        ),
        'https://komisio.invalid',
      ).searchParams.get('returnTo'),
    ).toBe('/intake/payouts?page=2#payouts-history')
    const explicit =
      item +
      '?returnTo=' +
      encodeURIComponent('/intake/items?page=2#inventory-item-' + id)
    expect(detailFromOrigin(explicit, '/intake/items')).toBe(explicit)
    expect(detailFromOrigin(item, item)).toBe(item)
  })
  it.each([
    'https://evil.test/intake/items',
    '//evil.test',
    '/\\evil.test',
    '/intake/../intake/items',
    '/intake/%69tems',
    '/intake/items\n',
    '/api/export',
    '/login',
    '/intake/items/' + id + '/privacy',
    ['/intake/items'],
    '/intake/items?q=' + 'a'.repeat(4096),
  ])('rejects an invalid origin %j', (origin) => {
    expect(staffReturnHref(origin, '/intake/sales')).toBe('/intake/sales')
  })
  it('does not decorate external, download, list or unrecognized destinations', () => {
    for (const href of [
      'https://evil.test' + item,
      '/api/items/' + id + '/pdf',
      '/intake/items',
      '/intake/items/new',
    ]) {
      expect(isStaffDetailHref(href)).toBe(false)
      expect(detailFromOrigin(href, '/intake/items')).toBe(href)
    }
  })
})
describe('ephemeral return positions', () => {
  beforeEach(clearReturnPositions)
  it('restores once for the exact origin and never during another navigation', () => {
    rememberReturnPosition('/intake/items?q=coat', 740, 1000)
    requestReturnPosition('/intake/items?q=coat', 1200)
    expect(takeReturnPosition('/intake/items?q=hat', 1300)).toBeNull()
    expect(takeReturnPosition('/intake/items?q=coat', 1300)).toBe(740)
    expect(takeReturnPosition('/intake/items?q=coat', 1300)).toBeNull()
  })
  it('bounds memory, expires positions and clears them on store changes', () => {
    for (let i = 0; i < 51; i++)
      rememberReturnPosition('/intake/items?page=' + i, i, 1000)
    requestReturnPosition('/intake/items?page=0', 1100)
    expect(takeReturnPosition('/intake/items?page=0', 1200)).toBeNull()
    requestReturnPosition('/intake/items?page=50', 2000000)
    expect(takeReturnPosition('/intake/items?page=50', 2000100)).toBeNull()
    rememberReturnPosition('/intake/items', 740, 1000)
    requestReturnPosition('/intake/items', 1200)
    clearReturnPositions()
    expect(takeReturnPosition('/intake/items', 1300)).toBeNull()
  })
})
