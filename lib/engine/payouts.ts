import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Payouts (P2 S15): request, approve, pay, reject as facts. Money moves only
// in the ledger through the SQL transitions; this module validates the boundary.
const ids = { tenantId: z.uuid(), requestId: z.uuid() }
const price = z.string().regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/)
export const requestPayoutCommand = z.strictObject({
  action: z.literal('requestPayout'),
  ...ids,
  sellerId: z.uuid(),
  amount: price,
})
export const approvePayoutCommand = z.strictObject({
  action: z.literal('approvePayout'),
  ...ids,
  payoutId: z.uuid(),
  reason: z.string().trim().max(500).default(''),
})
export const markPayoutPaidCommand = z.strictObject({
  action: z.literal('markPayoutPaid'),
  ...ids,
  payoutId: z.uuid(),
  reference: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(500).default(''),
})
export const rejectPayoutCommand = z.strictObject({
  action: z.literal('rejectPayout'),
  ...ids,
  payoutId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
})
export const payoutStatus = z.enum([
  'requested',
  'approved',
  'paid',
  'rejected',
])
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const payoutRow = z.object({
  id: z.uuid(),
  seller_id: z.uuid(),
  amount_ore: ore,
  status: payoutStatus,
  rail: z.literal('manual'),
  request_source: z.enum(['staff', 'seller']),
  requested_at: z.iso.datetime({ offset: true }),
  approved_at: z.iso.datetime({ offset: true }).nullable(),
  paid_at: z.iso.datetime({ offset: true }).nullable(),
  payment_reference: z.string(),
})
export type PayoutRow = z.infer<typeof payoutRow>
const eventRow = z.object({
  id: z.uuid(),
  payout_id: z.uuid(),
  kind: payoutStatus,
  reason: z.string(),
  reference: z.string(),
  occurred_at: z.iso.datetime({ offset: true }),
})
const columns =
  'id,seller_id,amount_ore,status,rail,request_source,requested_at,approved_at,paid_at,payment_reference'

/** Newest 50 payouts, optionally for one seller. RLS scopes the read. */
export async function readPayouts(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput?: string,
) {
  let query = client
    .from('payouts')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
  if (sellerInput) query = query.eq('seller_id', z.uuid().parse(sellerInput))
  const { data, error } = await query
    .order('requested_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read payouts')
  return z.array(payoutRow).parse(data)
}

/** Events for a set of payouts, newest last, keyed by payout id. */
export async function readPayoutEvents(
  client: SupabaseClient,
  tenantInput: string,
  payoutIds: string[],
) {
  const list = z.array(z.uuid()).max(50).parse(payoutIds)
  if (!list.length) return new Map<string, z.infer<typeof eventRow>[]>()
  const { data, error } = await client
    .from('payout_events')
    .select('id,payout_id,kind,reason,reference,occurred_at')
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .in('payout_id', list)
    .order('occurred_at')
  if (error) throw new Error('Unable to read payout events')
  const map = new Map<string, z.infer<typeof eventRow>[]>()
  for (const e of z.array(eventRow).parse(data))
    map.set(e.payout_id, [...(map.get(e.payout_id) ?? []), e])
  return map
}
