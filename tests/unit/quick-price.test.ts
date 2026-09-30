import { expect, it } from 'vitest'
import { quickPriceOre } from '../../lib/intake/quick-price'

it('parses quick prices exactly in minor units, with a dot or comma', () => {
  for (const [input, expected] of [
    ['1.15', 115],
    ['0,29', 29],
    ['0.01', 1],
    [' 150,5 ', 15050],
    ['250', 25000],
    ['250.', 25000],
    ['0001,01', 101],
    ['999999.99', 99999999],
  ] as const)
    expect(quickPriceOre(input)).toBe(expected)
})

it('refuses excess precision, non-decimal syntax, zero and values beyond the engine limit', () => {
  for (const input of [
    '',
    ' ',
    '0',
    '-1',
    '1e2',
    '0x10',
    'Infinity',
    '1.005',
    '1000000',
    '999999.999',
    '1 000',
    '1,2.3',
  ]) {
    expect(quickPriceOre(input)).toBeNull()
  }
})
