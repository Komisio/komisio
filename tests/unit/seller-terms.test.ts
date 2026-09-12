import { expect, it } from 'vitest'
import {
  publishSellerTermsCommand,
  effectiveSellerTerms,
} from '../../lib/engine/seller-terms'
import { intakeCommand } from '../../lib/engine/intake'

const base = {
  action: 'publishSellerTerms',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  sellerId: '33333333-3333-4333-8333-333333333333',
  expectedCurrentId: null,
  commissionBasis: null,
  commissionRatePercent: null,
  notes: '',
}

it('accepts null fields as "use the store policy"', () => {
  expect(publishSellerTermsCommand.parse(base).commissionRatePercent).toBe(null)
  expect(intakeCommand.parse(base).action).toBe('publishSellerTerms')
  expect(
    publishSellerTermsCommand.parse({
      ...base,
      commissionBasis: 'exclusive',
      commissionRatePercent: 42.5,
      notes: ' Long-time seller ',
    }).notes,
  ).toBe('Long-time seller')
})
it('rejects lossy rates, unknown bases and unknown keys', () => {
  for (const patch of [
    { commissionRatePercent: 42.505 },
    { commissionRatePercent: 100.01 },
    { commissionRatePercent: -1 },
    { commissionRatePercent: '42' },
    { commissionBasis: 'gross' },
    { notes: 'x'.repeat(501) },
    { salePeriodDays: 30 },
  ])
    expect(
      publishSellerTermsCommand.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})
it('parses the effective terms shape the database returns', () => {
  const terms = effectiveSellerTerms.parse({
    sellerTermsId: null,
    version: 0,
    notes: '',
    commissionBasis: 'inclusive',
    commissionRatePercent: 60,
    overrides: { commissionBasis: false, commissionRatePercent: false },
    storePolicyId: null,
    storePolicyVersion: 0,
  })
  expect(terms.commissionRatePercent).toBe(60)
  expect(
    effectiveSellerTerms.safeParse({ ...terms, commissionRatePercent: '60' })
      .success,
  ).toBe(false)
})
