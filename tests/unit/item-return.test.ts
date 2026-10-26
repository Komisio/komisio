import { describe, expect, it } from 'vitest'
import {
  itemReturnHref,
  itemFromListHref,
  isIntakeReturn,
} from '@/lib/intake/item-return'
import { dictionary, locales } from '@/lib/i18n'

const id = '020a4d6b-ad3a-4ecb-be97-a45e7057402d'
describe('item return navigation', () => {
  it('retains a list query and the originating row in shareable item URLs', () => {
    const list =
      '/intake/items?q=coat&stage=on_sale&page=2&sort=title&direction=desc'
    const href = new URL(
      itemFromListHref(id, list, '#sync-status'),
      'https://komisio.invalid',
    )
    expect(href.pathname).toBe(`/intake/items/${id}`)
    expect(href.hash).toBe('#sync-status')
    expect(itemReturnHref(href.searchParams.get('returnTo'))).toBe(
      list + '#inventory-item-' + id,
    )
    expect(itemReturnHref(`/intake/bags/${id}/inspect?page=2`)).toBe(
      `/intake/bags/${id}/inspect?page=2`,
    )
  })
  it.each([
    undefined,
    null,
    [],
    '//example.com',
    'https://example.com/intake/items',
    '/\\example.com/intake/items',
    '/intake/items/other',
    '/settings',
    '/intake/items\n',
    '/intake/items?q=' + 'a'.repeat(4096),
  ])('falls back for invalid destinations: %j', (input) => {
    expect(itemReturnHref(input)).toBe('/intake/items')
  })
  it('does not restore arbitrary fragment targets', () => {
    expect(itemReturnHref('/intake/items?page=2#unexpected')).toBe(
      '/intake/items?page=2',
    )
  })
  it('distinguishes intake returns from inventory without accepting other routes', () => {
    const intake = `/intake/reception/${id}`
    expect(itemReturnHref(intake)).toBe(intake)
    expect(
      new URL(
        itemFromListHref(id, intake),
        'https://komisio.invalid',
      ).searchParams.get('returnTo'),
    ).toBe(intake)
    expect(isIntakeReturn(intake)).toBe(true)
    expect(isIntakeReturn(`/intake/bags/${id}/inspect?itemPage=2`)).toBe(true)
    expect(isIntakeReturn('/intake/items?q=coat')).toBe(false)
    expect(isIntakeReturn('/intake/reception/new')).toBe(false)
    expect(isIntakeReturn(`https://example.com${intake}`)).toBe(false)
    expect(itemReturnHref(`${intake}/other`)).toBe('/intake/items')
  })
  it.each(locales)('has a translated visible back label in %s', (locale) => {
    expect(dictionary(locale).returnNavigation.back.length).toBeGreaterThan(2)
    expect(dictionary(locale).items.backToIntake.length).toBeGreaterThan(5)
  })
})
