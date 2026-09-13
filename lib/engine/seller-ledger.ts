import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Seller ledger (P2 S14): append-only entries written by engine functions;
// balances are sums computed in SQL. Boundary validation only.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const ledgerKind = z.enum([
  'credit_sale',
  'credit_reversal',
  'payout_reserved',
  'payout_paid',
  'payout_released',
  'booking_charge',
  'adjustment',
])
export const adjustSellerLedgerCommand = z.strictObject({
  action: z.literal('adjustSellerLedger'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sellerId: z.uuid(),
  // Signed öre as exact decimal text with a sign: "-5.00" or "12.50".
  amount: z.string().regex(/^-?(?:0|[1-9]\d{0,8})\.\d{2}$/),
  reason: z.string().trim().min(1).max(500),
})
export const sellerBalance = z.strictObject({
  sellerId: z.uuid(),
  availableOre: ore,
  reservedOre: ore,
  creditedOre: ore,
  paidOre: ore,
  entries: z.number().int().nonnegative(),
})
export type SellerBalance = z.infer<typeof sellerBalance>
const entryRow = z.object({
  id: z.uuid(),
  kind: ledgerKind,
  amount_ore: ore,
  reference_kind: z.string(),
  reference_id: z.uuid(),
  reason: z.string(),
  occurred_at: z.iso.datetime({ offset: true }),
})
export type LedgerEntry = z.infer<typeof entryRow>

/** Sums computed in SQL under the caller's identity. */
export async function readSellerBalance(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const result = await client.rpc('seller_balance', {
    p_tenant: z.uuid().parse(tenantInput),
    p_seller: z.uuid().parse(sellerInput),
  })
  if (result.error) {
    if (result.error.message.includes('SELLER_NOT_FOUND'))
      throw new Error('SELLER_NOT_FOUND')
    throw new Error('FORBIDDEN')
  }
  return sellerBalance.parse(result.data)
}

/** Newest 50 entries for one seller; RLS scopes the read. */
export async function readSellerLedger(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const { data, error } = await client
    .from('seller_ledger_entries')
    .select('id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at')
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('seller_id', z.uuid().parse(sellerInput))
    .order('occurred_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read seller ledger')
  return z.array(entryRow).parse(data)
}

/** "-5.00" → -500; exact decimal text, never float. */
export function signedOreFromDecimal(input: string) {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(input)
  if (!m) throw new Error('INVALID_INPUT')
  const value = Number(m[2]) * 100 + Number(m[3])
  return m[1] ? -value : value
}

export function formatSignedOre(value: number) {
  const sign = value < 0 ? '-' : ''
  const abs = BigInt(Math.abs(value))
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}
