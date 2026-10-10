import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const ids = { tenantId: z.uuid(), requestId: z.uuid() }
/** Parse a human amount without floating point multiplication or rounding. */
export function feeAmountFromInput(input: string): number | undefined {
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(input.trim())
  if (!match) return undefined
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}
export const recordConsignmentFeePaymentCommand = z.strictObject({
  action: z.literal('recordConsignmentFeePayment'),
  ...ids,
  feeId: z.guid(),
  reference: z.string().trim().min(1).max(200),
})
export const reverseConsignmentFeeCommand = z.strictObject({
  action: z.literal('reverseConsignmentFee'),
  ...ids,
  feeId: z.guid(),
  reason: z.string().trim().min(1).max(500),
})
export const accrueSellerConsignmentFeesCommand = z.strictObject({
  action: z.literal('accrueSellerConsignmentFees'),
  ...ids,
  sellerId: z.uuid(),
})
export const feeAccrualResult = z.object({
  sellerId: z.uuid(),
  added: z.number().int().nonnegative(),
})
const ore = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform(Number)
const row = z.object({
  id: z.guid(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  net_ore: ore,
  vat_ore: ore,
  gross_ore: ore,
  currency: z.string(),
  collection: z.enum(['balance', 'separate']),
  status: z.enum(['deducted', 'unpaid', 'paid', 'reversed']),
  payment_reference: z.string().nullable().optional(),
  correction_reason: z.string().nullable().optional(),
})
export const consignmentFees = z.object({
  rows: z.array(row).max(25),
  total: z.number().int().nonnegative(),
})
export type ConsignmentFees = z.infer<typeof consignmentFees>

export async function readConsignmentFees(
  client: SupabaseClient,
  tenant: string,
  seller: string,
  offset = 0,
  portal = false,
): Promise<ConsignmentFees | null> {
  const r = await client.rpc(
    portal ? 'my_consignment_fees' : 'seller_consignment_fees',
    {
      p_tenant: z.uuid().parse(tenant),
      p_seller: z.uuid().parse(seller),
      p_offset: z.number().int().min(0).max(2147483647).parse(offset),
    },
  )
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('Unable to read consignment fees')
  return consignmentFees.parse(r.data)
}
