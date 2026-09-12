import { expect, it } from 'vitest'
import {
  defaultStorePolicy,
  storePolicyBody,
} from '../../lib/engine/store-policy'
import { selectVatMode, vatRateBasisPoints } from '../../lib/engine/vat'

it('lets a tenant select VAT modes in its store policy', () => {
  const chosen = storePolicyBody.parse({
    ...defaultStorePolicy(),
    vatModeConsignmentPrivate: 'consignment_margin',
    vatModeStoreOwned: 'store_margin',
    vatRatePercent: 25,
  })
  expect(chosen.vatModeConsignmentPrivate).toBe('consignment_margin')
  expect(
    selectVatMode(
      { ownership: 'store', sellerTaxable: false, marginAttested: true },
      chosen,
    ),
  ).toBe('store_margin')
  expect(vatRateBasisPoints(chosen)).toBe(2500)
})
it('keeps the pilot defaults free of any VAT choice', () => {
  const policy = defaultStorePolicy()
  expect('vatModeConsignmentPrivate' in policy).toBe(false)
  expect(vatRateBasisPoints(policy)).toBe(2500)
  expect(() =>
    selectVatMode(
      { ownership: 'consignment', sellerTaxable: false, marginAttested: false },
      policy,
    ),
  ).toThrow('VAT_MODE_NOT_SET')
})
it('rejects modes from the wrong group and lossy rates', () => {
  for (const patch of [
    { vatModeConsignmentPrivate: 'store_margin' },
    { vatModeStoreOwned: 'consignment_full' },
    { vatModeConsignmentBusiness: 'consignment_business' },
    { vatRatePercent: 25.001 },
    { vatRatePercent: 100.01 },
    { vatRatePercent: '25' },
    { vatRatePercent: -1 },
  ])
    expect(
      storePolicyBody.safeParse({ ...defaultStorePolicy(), ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})
