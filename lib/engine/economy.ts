import { z } from 'zod'
import { currencyCode } from './money'
import type { SupabaseClient } from '@supabase/supabase-js'

// Economy overview (P3): one read for any period, computed in SQL from the
// same facts and with the same sums as the day close. Boundary validation only.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const modeTotals = z.object({
  lines: z.number().int(),
  grossOre: ore,
  vatOre: ore,
  netOre: ore,
})
export const economySummary = z.object({
  from: isoDate,
  to: isoDate,
  timeZone: z.literal('Europe/Stockholm'),
  currency: currencyCode,
  totals: z.object({
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
    perMode: z.record(z.string(), modeTotals),
  }),
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
  liability: z.object({
    availableOre: ore,
    reservedOre: ore,
    owedOre: ore,
    sellersWithEntries: z.number().int(),
  }),
  openPayouts: z.object({ count: z.number().int(), amountOre: ore }),
})
export type EconomySummary = z.infer<typeof economySummary>
export const economyPeriod = z
  .strictObject({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, 'from must not be after to')
  .refine(
    (p) => Date.parse(p.to) - Date.parse(p.from) <= 366 * 86_400_000,
    'at most one year',
  )

/** Local calendar month bounds for a default period. */
export function currentMonthPeriod(now = new Date()) {
  const local = now.toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
  })
  const [y, m] = local.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(last).padStart(2, '0')}`,
  }
}

/** Sums computed in SQL under the caller's identity; any member may read. */
export async function readEconomySummary(
  client: SupabaseClient,
  tenantInput: string,
  periodInput: unknown,
) {
  const period = economyPeriod.parse(periodInput)
  const result = await client.rpc('economy_summary', {
    p_tenant: z.uuid().parse(tenantInput),
    p_from: period.from,
    p_to: period.to,
  })
  if (result.error) {
    if (result.error.message.includes('INVALID_INPUT'))
      throw new Error('INVALID_INPUT')
    throw new Error('FORBIDDEN')
  }
  return economySummary.parse(result.data)
}
