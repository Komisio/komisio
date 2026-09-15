import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { economyPeriod } from './economy'

// Chains (docs/CHAIN-GROUPING.md, step 1): an optional label above stores and
// one cross-store economy read. Writes go through the platform route, which
// calls the SQL functions; the database checks ownership of every store.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const role = z.enum(['owner', 'admin', 'staff', 'readonly']).nullable()
export const chainOverview = z
  .object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.string(),
    stores: z
      .array(
        z.object({ id: z.uuid(), name: z.string(), slug: z.string(), role }),
      )
      .max(50),
  })
  .nullable()
export type ChainOverview = z.infer<typeof chainOverview>

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
export const chainEconomySummary = z.object({
  chainId: z.uuid(),
  from: z.string(),
  to: z.string(),
  timeZone: z.literal('Europe/Stockholm'),
  storeCount: z.number().int(),
  currency: z.string().nullable(),
  mixedCurrencies: z.boolean(),
  stores: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        currency: z.string(),
        totals: totals.loose(),
        liability: z.object({ owedOre: ore }).loose(),
        openPayouts: z.object({ count: z.number().int(), amountOre: ore }),
      }),
    )
    .max(50),
  total: totals
    .extend({
      owedOre: ore,
      openPayoutsCount: z.number().int(),
      openPayoutsOre: ore,
    })
    .nullable(),
})
export type ChainEconomySummary = z.infer<typeof chainEconomySummary>

/** The chain of one store, or null. Null too until the migration is live. */
export async function readChainOverview(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('chain_overview', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return chainOverview.parse(r.data)
}

/** Per-store summaries and the total; the database requires owner or admin in every store. */
export async function readChainEconomySummary(
  client: SupabaseClient,
  chainInput: string,
  periodInput: unknown,
) {
  const period = economyPeriod.parse(periodInput)
  const r = await client.rpc('chain_economy_summary', {
    p_chain: z.uuid().parse(chainInput),
    p_from: period.from,
    p_to: period.to,
  })
  if (r.error) {
    if (r.error.message.includes('INVALID_INPUT'))
      throw new Error('INVALID_INPUT')
    throw new Error('FORBIDDEN')
  }
  return chainEconomySummary.parse(r.data)
}
