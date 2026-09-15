import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { economyPeriod } from './economy'

// Stock report (P3): margin, sell-through and stock age per category for a
// period, computed in SQL from the store's own facts. Read only, any member.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const percent = z.union([z.number(), z.string()]).transform(Number).nullable()
const buckets = z.object({
  d0to14: z.number().int(),
  d15to28: z.number().int(),
  d29to42: z.number().int(),
  d43plus: z.number().int(),
})
export const stockReport = z.object({
  currency: z.string(),
  from: z.string(),
  to: z.string(),
  timeZone: z.literal('Europe/Stockholm'),
  categories: z
    .array(
      z.object({
        category: z.string(),
        inStock: z.number().int(),
        stockValueOre: ore,
        averageAgeDays: z.number().int().nullable(),
        oldestAgeDays: z.number().int().nullable(),
        ageBuckets: buckets,
        soldCount: z.number().int(),
        soldGrossOre: ore,
        marginOre: ore,
        marginPercent: percent,
        sellThroughPercent: percent,
        averageDaysToSale: z.number().int().nullable(),
      }),
    )
    .max(500),
  total: z.object({
    inStock: z.number().int(),
    stockValueOre: ore,
    ageBuckets: buckets,
    soldCount: z.number().int(),
    soldGrossOre: ore,
    marginOre: ore,
    marginPercent: percent,
    sellThroughPercent: percent,
  }),
})
export type StockReport = z.infer<typeof stockReport>

/** Null until the migration is live; FORBIDDEN or INVALID_INPUT otherwise. */
export async function readStockReport(
  client: SupabaseClient,
  tenantInput: string,
  periodInput: unknown,
) {
  const period = economyPeriod.parse(periodInput)
  const r = await client.rpc('stock_report', {
    p_tenant: z.uuid().parse(tenantInput),
    p_from: period.from,
    p_to: period.to,
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) {
    if (r.error.message.includes('INVALID_INPUT'))
      throw new Error('INVALID_INPUT')
    throw new Error('FORBIDDEN')
  }
  return stockReport.parse(r.data)
}
