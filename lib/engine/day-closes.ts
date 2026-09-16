import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Day closes (P2 S17): versioned totals for one local day, derived in SQL
// from sales, returns and paid payouts. Boundary validation only.
export const generateDayCloseCommand = z.strictObject({
  action: z.literal('generateDayClose'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const modeTotals = z.object({
  lines: z.number().int(),
  grossOre: ore,
  vatOre: ore,
  netOre: ore,
})
const dayCloseRow = z.object({
  id: z.uuid(),
  close_date: z.string(),
  version: z.number().int(),
  sales_count: z.number().int(),
  returns_count: z.number().int(),
  gross_ore: ore,
  vat_ore: ore,
  commission_ore: ore,
  commission_vat_ore: ore,
  seller_credit_ore: ore,
  refunds_ore: ore,
  credit_reversed_ore: ore,
  payouts_paid_ore: ore,
  per_mode: z.record(z.string(), modeTotals),
  generated_at: z.iso.datetime({ offset: true }),
})
export type DayClose = z.infer<typeof dayCloseRow>
const columns =
  'id,close_date,version,sales_count,returns_count,gross_ore,vat_ore,commission_ore,commission_vat_ore,seller_credit_ore,refunds_ore,credit_reversed_ore,payouts_paid_ore,per_mode,generated_at'

/** Newest 60 day closes, latest version first per day. RLS scopes the read. */
export async function readDayCloses(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('day_close_page', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error) throw new Error('Unable to read day closes')
  return z.array(dayCloseRow).parse(r.data)
}
