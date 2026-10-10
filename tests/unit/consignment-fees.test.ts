import { describe, expect, it } from 'vitest'
import { feeAmountFromInput } from '../../lib/engine/consignment-fees'
import {
  defaultStorePolicy,
  storePolicyBody,
} from '../../lib/engine/store-policy'

describe('monthly fee policy boundary', () => {
  it('parses Swedish decimal amounts exactly and refuses silent rounding', () => {
    expect(feeAmountFromInput('100,01')).toBe(10001)
    expect(feeAmountFromInput('1.1')).toBe(110)
    expect(feeAmountFromInput('100')).toBe(10000)
    for (const value of ['1.005', '-100', 'Infinity', '1e3', '', '100000000'])
      expect(feeAmountFromInput(value)).toBeUndefined()
  })
  it('requires explicitly selected fee VAT independently of goods VAT', () => {
    const policy = {
      ...defaultStorePolicy(),
      consignmentPeriod: {
        months: 3,
        collectionDays: 2,
        monthlyFee: {
          amountOre: 10000,
          collection: 'balance',
          vatBasis: 'exclusive',
          vatRatePercent: 25,
        },
      },
    }
    expect(storePolicyBody.safeParse(policy).success).toBe(true)
    expect(
      storePolicyBody.safeParse({
        ...policy,
        consignmentPeriod: {
          ...policy.consignmentPeriod,
          monthlyFee: {
            ...policy.consignmentPeriod.monthlyFee,
            vatRatePercent: undefined,
          },
        },
      }).success,
    ).toBe(false)
    expect(defaultStorePolicy().consignmentPeriod).toBeUndefined()
  })
})
