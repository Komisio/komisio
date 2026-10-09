import { expect, it } from 'vitest'
import { evaluatePricing } from '../../lib/assistance/pricing-evaluation'

const row = {
  itemId: '10000000-0000-4000-8000-000000000001',
  currency: 'SEK',
  prediction: {
    at: '2026-09-01T10:00:00Z',
    lowOre: 15000,
    highOre: 25000,
    basis: 'model_estimate',
  },
  staffDecision: { at: '2026-09-02T10:00:00Z', priceOre: 20000 },
  sale: { at: '2026-09-03T10:00:00Z', priceOre: 16000, returned: false },
}
const cohort = {
  version: 1,
  marketCountry: 'SE',
  currency: 'SEK',
  observations: [row],
}
it('separates staff agreement from realized price and exposes wide ranges', () => {
  const result = evaluatePricing(cohort)
  expect(result.staffDecision.meanAbsoluteErrorPercent).toBe(0)
  expect(result.completedSale.meanAbsoluteErrorPercent).toBe(25)
  expect(result.completedSale.meanBiasPercent).toBe(25)
  expect(result.completedSale.rangeCoveragePercent).toBe(100)
  expect(result.completedSale.meanRangeWidthPercent).toBe(62.5)
  expect(result.byBasis.web.completedSale.count).toBe(0)
})
it('does not treat missing estimates, unsold goods or returns as successful predictions', () => {
  const result = evaluatePricing({
    ...cohort,
    observations: [
      { ...row, sale: { ...row.sale, returned: true } },
      {
        ...row,
        itemId: '10000000-0000-4000-8000-000000000002',
        prediction: null,
        sale: null,
      },
    ],
  })
  expect(result.estimates).toBe(1)
  expect(result.withoutEstimate).toBe(1)
  expect(result.withoutSale).toBe(1)
  expect(result.returnedSalesExcluded).toBe(1)
  expect(result.completedSale.meanAbsoluteErrorPercent).toBeNull()
  expect(result.staffDecision.count).toBe(1)
})
it('rejects duplicate goods and mixed currency rather than averaging unlike samples', () => {
  expect(() =>
    evaluatePricing({ ...cohort, observations: [row, row] }),
  ).toThrow()
  expect(() => evaluatePricing({ ...cohort, currency: 'EUR' })).toThrow()
})
it('rejects hindsight estimates, reversed ranges and fractional minor units', () => {
  for (const prediction of [
    { ...row.prediction, at: row.staffDecision.at },
    { ...row.prediction, lowOre: 26000 },
    { ...row.prediction, lowOre: 15000.5 },
  ])
    expect(() =>
      evaluatePricing({ ...cohort, observations: [{ ...row, prediction }] }),
    ).toThrow()
})
it('reports missed ranges and direction without rounding monetary inputs', () => {
  const result = evaluatePricing({
    ...cohort,
    observations: [
      {
        ...row,
        prediction: { ...row.prediction, lowOre: 10000, highOre: 15000 },
      },
    ],
  })
  expect(result.completedSale.rangeCoveragePercent).toBe(0)
  expect(result.completedSale.meanBiasPercent).toBe(-21.9)
})
