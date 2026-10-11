import { expect, it } from 'vitest'
import { itemFilters } from '../../lib/engine/item-directory'

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
