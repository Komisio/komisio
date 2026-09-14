import { expect, it } from 'vitest'
import { compareZettleVat } from '../../lib/engine/zettle-vat'
import { vatRateBasisPoints } from '../../lib/engine/vat'

it.each([
  ['25', 2500, 'match'],
  ['25.00', 2500, 'match'],
  ['12.34', 1234, 'match'],
  ['0', 2500, 'mismatch'],
  ['0', 0, 'match'],
  ['', 2500, 'unmapped'],
  [' ', 2500, 'unmapped'],
  ['NaN', 2500, 'invalid'],
  ['101', 2500, 'invalid'],
  ['25.001', 2500, 'invalid'],
] as const)(
  'compares %s with %s without correcting it',
  (mapped, rate, result) => {
    expect(compareZettleVat(mapped, rate)).toBe(result)
  },
)
it('uses the same current-policy and default rate as the engine', () => {
  expect(compareZettleVat('25', vatRateBasisPoints({}))).toBe('match')
  expect(
    compareZettleVat('25', vatRateBasisPoints({ vatRatePercent: 12 })),
  ).toBe('mismatch')
})
