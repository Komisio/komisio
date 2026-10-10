import { z } from 'zod'
import { pricingCohort, pricingBasis } from '../engine/pricing-cohort'
export { pricingCohort } from '../engine/pricing-cohort'

type Observation = z.infer<typeof pricingCohort>['observations'][number]
function comparison(rows: Observation[], target: 'staffDecision' | 'sale') {
  const measured = rows.flatMap((row) => {
    const p = row.prediction,
      outcome = row[target]
    if (!p || !outcome || (target === 'sale' && row.sale?.returned)) return []
    const low = BigInt(p.lowOre),
      high = BigInt(p.highOre),
      actual = BigInt(outcome.priceOre)
    // Money stays integral. Floating point is used only for dimensionless percentages.
    const difference = low + high - 2n * actual
    return [
      {
        absoluteErrorPercent:
          (Number(difference < 0n ? -difference : difference) /
            Number(2n * actual)) *
          100,
        biasPercent: (Number(difference) / Number(2n * actual)) * 100,
        widthPercent: (Number(high - low) / Number(actual)) * 100,
        covered: actual >= low && actual <= high,
      },
    ]
  })
  if (!measured.length)
    return {
      count: 0,
      meanAbsoluteErrorPercent: null,
      meanBiasPercent: null,
      rangeCoveragePercent: null,
      meanRangeWidthPercent: null,
    }
  const average = (values: number[]) =>
    Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) /
    10
  return {
    count: measured.length,
    meanAbsoluteErrorPercent: average(
      measured.map((m) => m.absoluteErrorPercent),
    ),
    meanBiasPercent: average(measured.map((m) => m.biasPercent)),
    rangeCoveragePercent: average(measured.map((m) => (m.covered ? 100 : 0))),
    meanRangeWidthPercent: average(measured.map((m) => m.widthPercent)),
  }
}

/** Descriptive pilot metrics, never evidence of general market accuracy. No I/O. */
export function evaluatePricing(input: unknown) {
  const cohort = pricingCohort.parse(input),
    rows = cohort.observations
  return {
    marketCountry: cohort.marketCountry,
    currency: cohort.currency,
    items: rows.length,
    estimates: rows.filter((r) => r.prediction).length,
    withoutEstimate: rows.filter((r) => !r.prediction).length,
    withoutSale: rows.filter((r) => !r.sale).length,
    returnedSalesExcluded: rows.filter((r) => r.sale?.returned).length,
    staffDecision: comparison(rows, 'staffDecision'),
    completedSale: comparison(rows, 'sale'),
    byBasis: Object.fromEntries(
      pricingBasis.options.map((b) => {
        const selected = rows.filter((r) => r.prediction?.basis === b)
        return [
          b,
          {
            estimates: selected.length,
            staffDecision: comparison(selected, 'staffDecision'),
            completedSale: comparison(selected, 'sale'),
          },
        ]
      }),
    ),
  }
}
