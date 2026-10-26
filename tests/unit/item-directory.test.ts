import { itemStage } from '../../lib/engine/items'
import {
  itemFilterHref,
  itemWeekCutoff,
} from '../../lib/engine/item-filter-navigation'
import { expect, it } from 'vitest'
import { itemFilters } from '../../lib/engine/item-directory'

it('validates linked category filters while retaining legacy text bookmarks', () => {
  expect(
    itemFilters.safeParse({
      categoryId: '40000000-0000-4000-8000-000000000001',
    }).success,
  ).toBe(true)
  expect(itemFilters.safeParse({ categoryId: 'none' }).success).toBe(true)
  expect(itemFilters.safeParse({ categoryId: 'Books' }).success).toBe(false)
  expect(itemFilters.safeParse({ category: 'Books' }).success).toBe(true)
})

it('rejects malformed URL prices without throwing and compares whole minor units', () => {
  for (const minPrice of [
    'wrong',
    '1e2',
    '-1',
    '0.001',
    'Infinity',
    "1');select 1",
  ]) {
    expect(itemFilters.safeParse({ minPrice, maxPrice: '10' }).success).toBe(
      false,
    )
  }
  expect(
    itemFilters.safeParse({ minPrice: '9.99', maxPrice: '10' }).success,
  ).toBe(true)
  expect(
    itemFilters.safeParse({ minPrice: '10', maxPrice: '9.99' }).success,
  ).toBe(false)
  expect(
    itemFilters.safeParse({ minPrice: '0', maxPrice: '0.01' }).success,
  ).toBe(true)
})

it('refuses invalid calendar dates, reversed intervals and unknown criteria', () => {
  for (const filter of [
    { acceptedFrom: '2026-02-30' },
    { acceptedFrom: '0000-01-01' },
    { acceptedFrom: '2026-10-20', acceptedTo: '2026-10-19' },
    { ownership: 'other' },
    { seller: 'x'.repeat(121) },
    { unknown: 'ignored' },
  ])
    expect(itemFilters.safeParse(filter).success).toBe(false)
  expect(
    itemFilters.safeParse({
      acceptedFrom: '2026-10-20',
      acceptedTo: '2026-10-20',
    }).success,
  ).toBe(true)
})

it('accepts the combined active read filter without adding a lifecycle stage', () => {
  expect(itemFilters.safeParse({ stage: 'active' }).success).toBe(true)
  expect(itemStage.safeParse('active').success).toBe(false)
})

it('removes just one filter and resets pagination while preserving sorting', () => {
  const url = new URL(
    itemFilterHref(
      {
        q: 'Blue & green',
        stage: 'active',
        category: 'Jackets',
        sort: 'price',
        direction: 'asc',
        page: '2',
      },
      { category: null },
    ),
    'https://example.test',
  )
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: 'Blue & green',
    stage: 'active',
    sort: 'price',
    direction: 'asc',
  })
  expect(itemFilterHref({ category: 'Jackets' }, { category: null })).toBe(
    '/intake/items',
  )
})

it('uses seven Stockholm calendar days across midnight, DST and year end', () => {
  expect(itemWeekCutoff(new Date('2026-10-24T22:30:00Z'))).toBe('2026-11-01')
  expect(itemWeekCutoff(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-08')
})

it('accepts only the supported upcoming stock period window', () => {
  expect(
    itemFilters.safeParse({ periodWindow: 'next7days', stage: 'markdown_due' })
      .success,
  ).toBe(true)
  expect(itemFilters.safeParse({ periodWindow: 'last7days' }).success).toBe(
    false,
  )
})
