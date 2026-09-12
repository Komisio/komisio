import { expect, it } from 'vitest'
import {
  defaultStorePolicy,
  storePolicyBody,
} from '../../lib/engine/store-policy'

// Synthetic explicit values, not the defaults of a real store.
const policy = () => ({
  commissionBasis: 'inclusive',
  commissionRatePercent: 35.25,
  agreementRequiredFor: ['review_publication', 'acceptance'],
  custodySources: ['staff_receipt'],
  sellerReviewMode: 'delegated',
  salePeriodDays: 60,
  unsoldNotifyAfterDays: 60,
  markdownSteps: [{ afterDays: 30, percent: 15.5 }],
  endOfPeriodAction: 'return',
  minPayoutThreshold: 100.25,
})

it('preserves an explicit policy and does not mutate caller input', () => {
  const input = policy()
  const result = storePolicyBody.parse(input)
  expect(result).toEqual(input)
  result.markdownSteps[0].percent = 25
  expect(input.markdownSteps[0].percent).toBe(15.5)
})

it('requires every field instead of fabricating commercial defaults', () => {
  for (const key of Object.keys(policy())) {
    const input: Record<string, unknown> = policy()
    delete input[key]
    expect(storePolicyBody.safeParse(input).success, key).toBe(false)
  }
})

it('accepts both review modes, bases and end actions without forcing consent', () => {
  expect(
    storePolicyBody.parse({
      ...policy(),
      commissionBasis: 'exclusive',
      sellerReviewMode: 'per_item',
      endOfPeriodAction: 'charity',
      agreementRequiredFor: [],
      custodySources: ['staff_receipt', 'locker', 'seller_dropoff'],
      markdownSteps: [],
    }).sellerReviewMode,
  ).toBe('per_item')
  expect(storePolicyBody.parse(policy()).sellerReviewMode).toBe('delegated')
})

it('rejects unknown fields, future flags and unsupported subset entries', () => {
  for (const patch of [
    { tenantId: 'model-selected' },
    { assistanceEnabled: true },
    { sellerReviewMode: 'automatic' },
    { commissionBasis: 'gross' },
    { endOfPeriodAction: 'discard' },
    { agreementRequiredFor: ['sale'] },
    { custodySources: ['camera_guess'] },
    { markdownSteps: [{ afterDays: 1, percent: 10, automatic: true }] },
    { agreementRequiredFor: ['acceptance', 'acceptance'] },
    { custodySources: ['locker', 'locker'] },
  ])
    expect(storePolicyBody.safeParse({ ...policy(), ...patch }).success).toBe(
      false,
    )
})

it('rejects lossy, coerced, negative and nonfinite numeric inputs', () => {
  for (const key of ['commissionRatePercent', 'minPayoutThreshold']) {
    for (const value of [-1, NaN, Infinity, -Infinity, 0.001, '35.25', null]) {
      expect(
        storePolicyBody.safeParse({ ...policy(), [key]: value }).success,
      ).toBe(false)
    }
  }
  expect(
    storePolicyBody.safeParse({ ...policy(), commissionRatePercent: 100.01 })
      .success,
  ).toBe(false)
  for (const value of [-1, 0, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      storePolicyBody.safeParse({ ...policy(), salePeriodDays: value }).success,
    ).toBe(false)
  }
})

it('validates markdown inputs without inventing execution semantics', () => {
  for (const step of [
    { afterDays: -1, percent: 5 },
    { afterDays: 1.5, percent: 5 },
    { afterDays: 1, percent: 100.01 },
    { afterDays: 1, percent: 0.001 },
  ])
    expect(
      storePolicyBody.safeParse({ ...policy(), markdownSteps: [step] }).success,
    ).toBe(false)
  expect(
    storePolicyBody.parse({
      ...policy(),
      commissionRatePercent: 0,
      minPayoutThreshold: 0,
      markdownSteps: [{ afterDays: 0, percent: 100 }],
    }).markdownSteps,
  ).toEqual([{ afterDays: 0, percent: 100 }])
})

it('uses the owner-confirmed pilot defaults exactly, including the store commission', () => {
  expect(defaultStorePolicy()).toEqual({
    commissionBasis: 'inclusive',
    commissionRatePercent: 60,
    agreementRequiredFor: ['review_publication', 'acceptance'],
    custodySources: ['staff_receipt'],
    sellerReviewMode: 'delegated',
    salePeriodDays: 42,
    markdownSteps: [
      { afterDays: 14, percent: 10 },
      { afterDays: 28, percent: 25 },
      { afterDays: 42, percent: 50 },
    ],
    endOfPeriodAction: 'charity',
    unsoldNotifyAfterDays: 60,
    minPayoutThreshold: 100,
  })
})

it('keeps one callers edits out of other tenants default policies', () => {
  const first = defaultStorePolicy()
  first.markdownSteps[0].percent = 99
  first.agreementRequiredFor.length = 0
  first.custodySources.push('locker')
  first.commissionRatePercent = 1
  const second = defaultStorePolicy()
  expect(second.markdownSteps[0].percent).toBe(10)
  expect(second.agreementRequiredFor).toEqual([
    'review_publication',
    'acceptance',
  ])
  expect(second.custodySources).toEqual(['staff_receipt'])
  expect(second.commissionRatePercent).toBe(60)
})

it('validates the unsold notification day without relating it to automatic disposal', () => {
  for (const value of [-1, 1.5, Infinity, '60', null]) {
    expect(
      storePolicyBody.safeParse({ ...policy(), unsoldNotifyAfterDays: value })
        .success,
    ).toBe(false)
  }
  expect(
    storePolicyBody.parse(defaultStorePolicy()).unsoldNotifyAfterDays,
  ).toBe(60)
})
