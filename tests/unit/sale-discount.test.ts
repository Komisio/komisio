import { expect, it } from 'vitest'
import { discountedPriceOre } from '../../lib/intake/sale-discount'

it('uses the catalogue price and rounds the discounted final price half up', () => {
  expect(discountedPriceOre(50_000n, '20', 'percent')).toBe(40_000n)
  expect(discountedPriceOre(50_000n, '12,50', 'percent')).toBe(43_750n)
  expect(discountedPriceOre(101n, '50', 'percent')).toBe(51n)
  expect(discountedPriceOre(99_999_999_999n, '10', 'percent')).toBe(
    89_999_999_999n,
  )
  expect(discountedPriceOre(50_000n, '100.01', 'amount')).toBe(39_999n)
  expect(discountedPriceOre(50_000n, '', 'amount')).toBe(50_000n)
  expect(discountedPriceOre(50_000n, '0', 'percent')).toBe(50_000n)
})

it('rejects invalid discounts and zero or negative final prices', () => {
  for (const input of ['100', '101', '-10', '0.001', 'x', '1e2']) {
    expect(discountedPriceOre(50_000n, input, 'percent')).toBeNull()
  }
  expect(discountedPriceOre(1n, '99', 'percent')).toBeNull()
  expect(discountedPriceOre(101n, '1,01', 'amount')).toBeNull()
  expect(discountedPriceOre(101n, '1,02', 'amount')).toBeNull()
})
