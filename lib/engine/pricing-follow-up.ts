import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pricingCohort } from './pricing-cohort'
import { currencyCode } from './money'

export const pricingPeriod = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86400000
    return days >= 0 && days <= 365
  })

/** Calendar dates, consistent with the existing Stockholm reporting boundary. */
export function recentPricingPeriod(now = new Date()) {
  const to = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 89)
  return { from: start.toISOString().slice(0, 10), to }
}

const count = z.number().int().min(0).max(5000)
export const pricingFollowUp = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    asOf: z.iso.datetime({ offset: true }),
    marketCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    currency: currencyCode,
    receivedItems: count,
    withoutAssessment: count,
    otherMarketOrCurrency: count,
    invalidTiming: count,
    cohort: pricingCohort.nullable(),
  })
  .superRefine((report, ctx) => {
    const cohort = report.cohort
    const eligible =
      report.receivedItems -
      report.withoutAssessment -
      report.otherMarketOrCurrency
    if (
      eligible !== (cohort?.observations.length ?? 0) ||
      report.invalidTiming > eligible ||
      (cohort &&
        (cohort.currency !== report.currency ||
          cohort.marketCountry !== report.marketCountry))
    )
      ctx.addIssue({ code: 'custom', message: 'INCONSISTENT_COHORT' })
  })
export type PricingFollowUp = z.infer<typeof pricingFollowUp>

export async function readPricingFollowUp(
  client: SupabaseClient,
  tenantId: string,
  input: unknown,
) {
  const period = pricingPeriod.parse(input)
  const result = await client.rpc('pricing_follow_up', {
    p_tenant: z.uuid().parse(tenantId),
    p_from: period.from,
    p_to: period.to,
  })
  if (result.error)
    throw new Error(
      [
        'PERIOD_TOO_LARGE',
        'INVALID_INPUT',
        'FORBIDDEN',
        'AUTH_REQUIRED',
      ].includes(result.error.message)
        ? result.error.message
        : 'REQUEST_FAILED',
    )
  const report = pricingFollowUp.parse(result.data)
  if (report.from !== period.from || report.to !== period.to)
    throw new Error('UNCONFIRMED_RESULT')
  return report
}
