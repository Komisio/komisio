import { expect, it } from 'vitest'
import { accountingMapBody } from '../../lib/engine/accounting'
import { economicMapBody } from '../../lib/engine/economic'
const excluded = {
  'payment:mobilepay:grossOre': {
    excludeReason: 'Store books the entire sale',
  },
  'payment:mobilepay:refundsOre': {
    excludeReason: 'Store books the entire sale',
  },
}
it('requires explicit complete method exclusions for both targets', () => {
  for (const schema of [accountingMapBody, economicMapBody]) {
    expect(schema.safeParse(excluded).success).toBe(true)
    expect(
      schema.safeParse({
        'payment:mobilepay:grossOre': excluded['payment:mobilepay:grossOre'],
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...excluded,
        'payment:mobilepay:refundsOre': { excludeReason: 'Different reason' },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...excluded,
        'mode:consignment_fee:grossOre': { excludeReason: 'Skip fee' },
      }).success,
    ).toBe(false)
  }
  expect(
    accountingMapBody.safeParse({ grossOre: { excludeReason: 'Not a method' } })
      .success,
  ).toBe(false)
})
it('accepts explicit separate payment accounts without altering legacy maps', () => {
  expect(
    accountingMapBody.safeParse({
      grossOre: { account: '1910', side: 'debit' },
    }).success,
  ).toBe(true)
  expect(
    accountingMapBody.safeParse({
      'payment:mobilepay:grossOre': { account: '1930', side: 'debit' },
      'payment:mobilepay:refundsOre': { account: '1930', side: 'credit' },
    }).success,
  ).toBe(true)
  expect(
    economicMapBody.safeParse({
      'payment:mobilepay:grossOre': {
        account: '1000',
        side: 'debit',
        vatCode: 'UEUV',
      },
    }).success,
  ).toBe(true)
})
