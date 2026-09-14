import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currencyCode } from './money'
import { formatSignedOre } from './seller-ledger'

// Weekly and monthly brief (P3): a deterministic rendering of the economy
// summary for one calendar period and the one before it. Fixed sentences
// over the store's own numbers; no model, no forecast, nothing stored.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const totals = z.object({
  salesCount: z.number().int(),
  linesCount: z.number().int(),
  grossOre: ore,
  vatOre: ore,
  netOre: ore,
  commissionOre: ore,
  commissionVatOre: ore,
  sellerCreditOre: ore,
  returnsCount: z.number().int(),
  refundsOre: ore,
  creditReversedOre: ore,
  payoutsPaidCount: z.number().int(),
  payoutsPaidOre: ore,
})
export const economyBrief = z.object({
  kind: z.enum(['week', 'month']),
  anchor: isoDate,
  currency: currencyCode,
  timeZone: z.literal('Europe/Stockholm'),
  period: z.object({ from: isoDate, to: isoDate }),
  previousPeriod: z.object({ from: isoDate, to: isoDate }),
  current: totals,
  previous: totals,
  days: z
    .array(
      z.object({
        date: isoDate,
        salesCount: z.number().int(),
        grossOre: ore,
        sellerCreditOre: ore,
      }),
    )
    .max(367),
  bestDay: z
    .object({ date: isoDate, salesCount: z.number().int(), grossOre: ore })
    .nullable(),
  itemsAccepted: z.number().int(),
  previousItemsAccepted: z.number().int(),
  liability: z.object({
    availableOre: ore,
    reservedOre: ore,
    owedOre: ore,
    sellersWithEntries: z.number().int(),
  }),
  openPayouts: z.object({ count: z.number().int(), amountOre: ore }),
})
export type EconomyBrief = z.infer<typeof economyBrief>
export const briefRequest = z.strictObject({
  kind: z.enum(['week', 'month']),
  anchor: isoDate.optional(),
})

export async function readEconomyBrief(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
) {
  const request = briefRequest.parse(input)
  const result = await client.rpc('economy_brief', {
    p_tenant: z.uuid().parse(tenantInput),
    p_kind: request.kind,
    p_end: request.anchor ?? null,
  })
  if (result.error) {
    if (result.error.message.includes('INVALID_INPUT'))
      throw new Error('INVALID_INPUT')
    throw new Error('FORBIDDEN')
  }
  return economyBrief.parse(result.data)
}

/** Whole-percent change from previous to current; null when there is no base. */
export function percentChange(current: number, previous: number) {
  if (previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

export type BriefFacts = {
  grossChange: number | null
  salesChange: number | null
  creditChange: number | null
  acceptedChange: number | null
  returnRatePercent: number | null
  sellDaysCount: number
  averageSaleOre: number | null
}

/** Comparisons the sentences are built from; integers only. */
export function briefFacts(b: EconomyBrief): BriefFacts {
  const c = b.current,
    p = b.previous
  return {
    grossChange: percentChange(c.grossOre, p.grossOre),
    salesChange: percentChange(c.salesCount, p.salesCount),
    creditChange: percentChange(c.sellerCreditOre, p.sellerCreditOre),
    acceptedChange: percentChange(b.itemsAccepted, b.previousItemsAccepted),
    returnRatePercent:
      c.salesCount === 0
        ? null
        : Math.round((c.returnsCount / c.salesCount) * 100),
    sellDaysCount: b.days.length,
    averageSaleOre:
      c.salesCount === 0 ? null : Math.round(c.grossOre / c.salesCount),
  }
}

export type BriefTexts = {
  weekTitle: string
  monthTitle: string
  noSales: string
  salesLine: string
  comparedUp: string
  comparedDown: string
  comparedSame: string
  comparedNoBase: string
  bestDay: string
  sellDays: string
  returnsLine: string
  noReturns: string
  creditLine: string
  payoutsLine: string
  noPayouts: string
  acceptedLine: string
  liabilityLine: string
  openPayoutsLine: string
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''))
}

/** The brief as ordered sentences; the same numbers render the same text every time. */
export function renderBrief(b: EconomyBrief, t: BriefTexts) {
  const f = briefFacts(b)
  const money = (v: number) => `${formatSignedOre(v)} ${b.currency}`
  const c = b.current
  const title = fill(b.kind === 'week' ? t.weekTitle : t.monthTitle, {
    from: b.period.from,
    to: b.period.to,
  })
  const lines: string[] = []
  if (c.salesCount === 0) {
    lines.push(fill(t.noSales, { from: b.period.from, to: b.period.to }))
  } else {
    lines.push(
      fill(t.salesLine, {
        sales: c.salesCount,
        gross: money(c.grossOre),
        average: money(f.averageSaleOre ?? 0),
      }),
    )
    const compared =
      f.grossChange === null
        ? t.comparedNoBase
        : f.grossChange > 0
          ? t.comparedUp
          : f.grossChange < 0
            ? t.comparedDown
            : t.comparedSame
    lines.push(
      fill(compared, {
        percent: Math.abs(f.grossChange ?? 0),
        previousGross: money(b.previous.grossOre),
        previousFrom: b.previousPeriod.from,
        previousTo: b.previousPeriod.to,
      }),
    )
    if (b.bestDay)
      lines.push(
        fill(t.bestDay, {
          date: b.bestDay.date,
          gross: money(b.bestDay.grossOre),
          sales: b.bestDay.salesCount,
        }),
      )
    lines.push(fill(t.sellDays, { days: f.sellDaysCount }))
    lines.push(
      c.returnsCount === 0
        ? t.noReturns
        : fill(t.returnsLine, {
            returns: c.returnsCount,
            refunds: money(c.refundsOre),
            rate: f.returnRatePercent ?? 0,
          }),
    )
    lines.push(
      fill(t.creditLine, {
        credit: money(c.sellerCreditOre),
        commission: money(c.commissionOre),
      }),
    )
  }
  lines.push(
    c.payoutsPaidCount === 0
      ? t.noPayouts
      : fill(t.payoutsLine, {
          count: c.payoutsPaidCount,
          amount: money(c.payoutsPaidOre),
        }),
  )
  lines.push(
    fill(t.acceptedLine, {
      accepted: b.itemsAccepted,
      previousAccepted: b.previousItemsAccepted,
    }),
  )
  lines.push(
    fill(t.liabilityLine, {
      owed: money(b.liability.owedOre),
      sellers: b.liability.sellersWithEntries,
    }),
  )
  if (b.openPayouts.count > 0)
    lines.push(
      fill(t.openPayoutsLine, {
        count: b.openPayouts.count,
        amount: money(b.openPayouts.amountOre),
      }),
    )
  return { title, lines, facts: f }
}
