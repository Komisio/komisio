import { z } from 'zod'

const ore = z.number().int().positive().max(99999999999)
const time = z.iso.datetime({ offset: true })
export const pricingBasis = z.enum([
  'store_sales',
  'web',
  'model_estimate',
  'mixed',
])
const observation = z
  .strictObject({
    itemId: z.uuid().transform((id) => id.toLowerCase()),
    currency: z.string().regex(/^[A-Z]{3}$/),
    prediction: z
      .strictObject({
        at: time,
        lowOre: ore,
        highOre: ore,
        basis: pricingBasis,
      })
      .nullable(),
    staffDecision: z.strictObject({ at: time, priceOre: ore }).nullable(),
    sale: z
      .strictObject({ at: time, priceOre: ore, returned: z.boolean() })
      .nullable(),
  })
  .superRefine((row, ctx) => {
    const p = row.prediction
    if (p && p.lowOre > p.highOre)
      ctx.addIssue({ code: 'custom', message: 'INVALID_RANGE' })
    // The estimate must predate either outcome; retrospective reruns are not predictions.
    if (
      p &&
      [row.staffDecision, row.sale].some(
        (outcome) => outcome && Date.parse(p.at) >= Date.parse(outcome.at),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'OUTCOME_LEAKAGE' })
  })
export const pricingCohort = z
  .strictObject({
    version: z.literal(1),
    marketCountry: z.string().regex(/^[A-Z]{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    observations: z.array(observation).min(1).max(10000),
  })
  .superRefine((cohort, ctx) => {
    if (
      new Set(cohort.observations.map((r) => r.itemId)).size !==
      cohort.observations.length
    )
      ctx.addIssue({ code: 'custom', message: 'DUPLICATE_ITEM' })
    if (cohort.observations.some((r) => r.currency !== cohort.currency))
      ctx.addIssue({ code: 'custom', message: 'MIXED_CURRENCY' })
  })
