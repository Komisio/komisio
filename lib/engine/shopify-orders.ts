import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listPaidOrders,
  nextCursor,
  orderToEvidence,
} from '../../extensions/shopify/orders'
import { shopifyAccessToken } from './shopify-connection'

// Orders in (step 3): one page of paid orders per request id, recorded as
// evidence through record_shopify_order_page, which matches lines by sku and
// records the sale for orders that match completely; the rest are held with
// a reason. Replaying a request id records nothing new. Owner or admin.
const count = z.union([z.number().int(), z.string()]).transform(Number)
export const shopifyOrderStatus = z.object({
  lastPullAt: z.string().nullable(),
  cursor: z.string().nullable(),
  pulls: count,
  held: count,
  orders: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        occurredAt: z.string(),
        currency: z.string(),
        amountOre: count,
        sourceName: z.string().nullable().optional(),
        retailLocationGid: z.string().nullable().optional(),
        holdReason: z.string().nullable(),
        lines: z.number().int(),
        saleId: z.string().nullable(),
        errorCode: z.string().nullable(),
        returned: count.optional(),
        refundsHeld: count.optional(),
        refundError: z.string().nullable().optional(),
      }),
    )
    .max(30),
})
export type ShopifyOrderStatus = z.infer<typeof shopifyOrderStatus>

export async function readShopifyOrderStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('shopify_order_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return shopifyOrderStatus.parse(r.data)
}

// The request id is a GUID, not always an RFC UUID: the scheduled run derives
// it from the store and the quarter hour.
export const pullShopifyOrdersInput = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.guid(),
})

export async function pullShopifyOrders(
  client: SupabaseClient,
  input: unknown,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const c = pullShopifyOrdersInput.parse(input)
  const prior = await client
    .from('shopify_order_pulls')
    .select('cursor_before,cursor_after,page')
    .eq('tenant_id', c.tenantId)
    .eq('id', c.requestId)
    .maybeSingle()
  if (prior.error) throw new Error('SHOPIFY_READ_FAILED')
  if (prior.data) {
    const replay = await client.rpc('record_shopify_order_page', {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_before: prior.data.cursor_before,
      p_after: prior.data.cursor_after,
      p_orders: prior.data.page,
    })
    if (replay.error) throw new Error(replay.error.message)
    return { id: c.requestId, replayed: true as const }
  }
  const { accessToken, row } = await shopifyAccessToken(
    client,
    c.tenantId,
    source,
    http,
  )
  const cursor = await client.rpc('shopify_order_cursor', {
    p_tenant: c.tenantId,
  })
  if (cursor.error) throw new Error('FORBIDDEN')
  const since = z.iso.datetime().parse(cursor.data)
  const orders = (
    await listPaidOrders(row.shopDomain, accessToken, since, http)
  ).map(orderToEvidence)
  const after = nextCursor(orders, since)
  const result = await client.rpc('record_shopify_order_page', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_before: since,
    p_after: after,
    p_orders: orders,
    // A pilot on a development shop only ever sees test orders; a deployment
    // says so explicitly. The evidence still records that they are test orders.
    p_accept_test: source.SHOPIFY_ACCEPT_TEST_ORDERS === 'true',
  })
  if (result.error) throw new Error(result.error.message)
  return { id: c.requestId, received: orders.length, cursor: after }
}

export async function retryShopifyOrder(
  client: SupabaseClient,
  tenantId: string,
  orderId: string,
) {
  const r = await client.rpc('reconcile_shopify_order', {
    p_tenant: z.uuid().parse(tenantId),
    p_order: z.uuid().parse(orderId),
  })
  if (r.error) throw new Error(r.error.message)
  return { orderId, saleId: (r.data as string | null) ?? null }
}
