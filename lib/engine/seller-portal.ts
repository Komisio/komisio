import { z } from 'zod'
import { selfBilling } from './self-billing'
import { ledgerItemDetails } from './seller-ledger'
import type { SupabaseClient } from '@supabase/supabase-js'

const money = z.number().int()
export const sellerAccounts = z.array(
  z.object({ tenantId: z.uuid(), sellerId: z.uuid(), storeName: z.string() }),
)
export const sellerEconomy = z.object({
  balance: z.object({
    sellerId: z.uuid(),
    availableOre: money,
    reservedOre: money,
    creditedOre: money,
    paidOre: money,
    entries: z.number().int().nonnegative(),
  }),
  thresholdOre: money,
  automaticEmails: z.boolean(),
  limit: z.literal(100),
  ledger: z.array(
    z.object({
      itemDetails: ledgerItemDetails.nullable().optional(),
      id: z.uuid(),
      kind: z.string(),
      amount_ore: money,
      occurred_at: z.string(),
    }),
  ),
  payouts: z.array(
    z.object({
      id: z.uuid(),
      amount_ore: money,
      status: z.string(),
      request_source: z.enum(['staff', 'seller']),
      requested_at: z.string(),
    }),
  ),
  statements: z.array(
    z.object({
      id: z.uuid(),
      is_self_billing: z.boolean().optional(),
      number: z.number().int(),
      kind: z.string(),
      period_from: z.string(),
      period_to: z.string(),
      opening_ore: money,
      closing_ore: money,
    }),
  ),
  messages: z.array(
    z
      .object({
        id: z.uuid(),
        kind: z.string().optional(),
        subject: z.string(),
        body: z.string(),
        status: z.string(),
        queued_at: z.string(),
      })
      .transform((value) => ({
        ...value,
        status:
          value.status === 'queued' &&
          (value.kind === 'period_ending' || value.kind === 'period_ended')
            ? 'unconfirmed'
            : value.status,
      })),
  ),
})
export const sellerStatement = z.object({
  header: z.object({
    self_billing: selfBilling.nullable().optional(),
    corrects_id: z.uuid().nullable().optional(),
    issued_at: z.string().optional(),
    sales_gross_ore: money.optional(),
    commission_ore: money.optional(),
    credited_ore: money.optional(),
    reversed_ore: money.optional(),
    paid_ore: money.optional(),
    adjustments_ore: money.optional(),
    seller_contact: z
      .object({ language: z.string().optional() })
      .nullable()
      .optional(),
    id: z.uuid(),
    number: z.number().int(),
    kind: z.string(),
    opening_ore: money,
    closing_ore: money,
    period_from: z.string(),
    period_to: z.string(),
  }),
  lines: z.array(
    z.object({
      id: z.uuid(),
      line_no: z.number().int(),
      kind: z.string(),
      amount_ore: money,
      occurred_at: z.string(),
      sale_price_ore: money.nullable(),
      commission_ore: money.nullable(),
    }),
  ),
})
export const sellerPortalCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('requestPayout'),
    tenantId: z.uuid(),
    sellerId: z.uuid(),
    requestId: z.uuid(),
    amountOre: money.positive().max(99999999999),
  }),
  z.strictObject({
    action: z.literal('notifications'),
    tenantId: z.uuid(),
    sellerId: z.uuid(),
    requestId: z.uuid(),
    enabled: z.boolean(),
  }),
])
export async function readMySellerAccounts(client: SupabaseClient) {
  const r = await client.rpc('my_seller_accounts')
  if (r.error) throw new Error('Unable to read seller accounts')
  return sellerAccounts.parse(r.data)
}
export async function readMySellerEconomy(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const r = await client.rpc('my_seller_economy', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
  })
  if (r.error) throw new Error('Unable to read seller economy')
  return sellerEconomy.parse(r.data)
}
export async function readMySellerStatement(
  client: SupabaseClient,
  tenant: string,
  seller: string,
  id: string,
) {
  const r = await client.rpc('my_seller_statement', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
    p_statement: z.uuid().parse(id),
  })
  if (r.error) return null
  return sellerStatement.parse(r.data)
}
export async function executeSellerPortal(
  client: SupabaseClient,
  input: unknown,
) {
  const c = sellerPortalCommand.parse(input)
  return c.action === 'requestPayout'
    ? client.rpc('request_my_payout', {
        p_tenant: c.tenantId,
        p_seller: c.sellerId,
        p_id: c.requestId,
        p_amount_ore: c.amountOre,
      })
    : client.rpc('set_my_seller_notifications', {
        p_tenant: c.tenantId,
        p_seller: c.sellerId,
        p_id: c.requestId,
        p_enabled: c.enabled,
      })
}
