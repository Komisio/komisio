import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { storeCurrencies } from '../platform/currencies'

const ore = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
const offsetSchema = z.number().int().min(0).max(2500000)
const time = z.iso.datetime({ offset: true })
const page = {
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  currency: z.enum(storeCurrencies),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  offset: offsetSchema,
  limit: z.literal(25),
}
export const sellerPayoutsPage = z
  .object({
    ...page,
    balance: z.object({
      sellerId: z.uuid(),
      availableOre: ore,
      reservedOre: ore,
      creditedOre: ore,
      paidOre: ore,
      entries: z.number().int().nonnegative(),
    }),
    thresholdOre: ore.nonnegative(),
    payouts: z
      .array(
        z.object({
          id: z.uuid(),
          amount_ore: ore.positive(),
          status: z.enum(['requested', 'approved', 'paid', 'rejected']),
          request_source: z.enum(['staff', 'seller']),
          requested_at: time,
        }),
      )
      .max(25),
  })
  .superRefine((value, ctx) => {
    if (
      value.balance.sellerId !== value.sellerId ||
      new Set(value.payouts.map((p) => p.id)).size !== value.payouts.length ||
      value.payouts.length > Math.max(0, value.total - value.offset)
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent payout page' })
  })
export const sellerStatementsPage = z
  .object({
    ...page,
    statements: z
      .array(
        z.object({
          id: z.uuid(),
          number: z.number().int().positive(),
          kind: z.enum(['statement', 'credit_note']),
          corrects_id: z.uuid().nullable(),
          period_from: time,
          period_to: time,
          opening_ore: ore,
          closing_ore: ore,
          issued_at: time,
          is_self_billing: z.boolean(),
        }),
      )
      .max(25),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.statements.map((s) => s.id)).size !==
        value.statements.length ||
      value.statements.length > Math.max(0, value.total - value.offset)
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent statement page' })
  })

async function history<
  T extends { tenantId: string; sellerId: string; offset: number },
>(
  client: SupabaseClient,
  name: string,
  schema: z.ZodType<T>,
  tenant: string,
  seller: string,
  offset: number,
) {
  const scope = {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
    p_offset: offsetSchema.parse(offset),
  }
  const result = await client.rpc(name, scope)
  if (result.error) throw new Error('Unable to read seller history')
  const value = schema.parse(result.data)
  if (
    value.tenantId !== tenant ||
    value.sellerId !== seller ||
    value.offset !== offset
  )
    throw new Error('Unexpected seller history scope')
  return value
}
export const readMySellerPayoutsPage = (
  client: SupabaseClient,
  tenant: string,
  seller: string,
  offset = 0,
) =>
  history(
    client,
    'my_seller_payouts_page',
    sellerPayoutsPage,
    tenant,
    seller,
    offset,
  )
export const readMySellerStatementsPage = (
  client: SupabaseClient,
  tenant: string,
  seller: string,
  offset = 0,
) =>
  history(
    client,
    'my_seller_statements_page',
    sellerStatementsPage,
    tenant,
    seller,
    offset,
  )
