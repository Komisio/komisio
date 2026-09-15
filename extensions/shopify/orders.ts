import { z } from 'zod'
import { graphql } from './auth'

// Admin API 2026-07: paid orders updated since a watermark, oldest first,
// reduced to the evidence the engine records. Amounts are parsed as integer
// öre from Shopify's decimal strings; nothing is computed here.

const money = z.object({
  shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }),
})
const orderNode = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Order\/\d{1,30}$/),
  name: z.string().min(1).max(40),
  createdAt: z.string(),
  updatedAt: z.string(),
  displayFinancialStatus: z.string().nullable(),
  test: z.boolean(),
  cancelledAt: z.string().nullable(),
  lineItems: z.object({
    nodes: z
      .array(
        z.object({
          sku: z.string().nullable(),
          title: z.string(),
          quantity: z.number().int(),
          discountedTotalSet: money,
        }),
      )
      .max(50),
  }),
})
export type OrderNode = z.infer<typeof orderNode>

const ORDERS = `query PaidOrders($q: String!, $first: Int!) {
  orders(first: $first, query: $q, sortKey: UPDATED_AT) {
    nodes {
      id name createdAt updatedAt displayFinancialStatus test cancelledAt
      lineItems(first: 50) { nodes { sku title quantity discountedTotalSet { shopMoney { amount currencyCode } } } }
    }
  }
}`

export const PAGE_SIZE = 50

/** Paid orders updated at or after the watermark (ISO instant), oldest update first. */
export async function listPaidOrders(
  shop: string,
  accessToken: string,
  sinceIso: string,
  http?: typeof fetch,
): Promise<OrderNode[]> {
  const since = z.iso.datetime().parse(sinceIso)
  const data = await graphql(
    shop,
    accessToken,
    ORDERS,
    { q: `financial_status:paid updated_at:>='${since}'`, first: PAGE_SIZE },
    http,
  )
  return z
    .object({ orders: z.object({ nodes: z.array(orderNode).max(PAGE_SIZE) }) })
    .parse(data).orders.nodes
}

/** "250.00" → 25000; refuses anything but a plain decimal with at most two places. */
export function toOre(amount: string) {
  const m = /^(-?)(\d{1,9})(?:\.(\d{1,2}))?$/.exec(amount)
  if (!m) throw new Error('SHOPIFY_AMOUNT_INVALID')
  const value = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] ? -value : value
}

export const orderEvidence = z.object({
  orderGid: z.string(),
  name: z.string(),
  occurredAt: z.string(),
  updatedAt: z.string(),
  currency: z.string().length(3),
  amountOre: z.number().int(),
  financialStatus: z.string(),
  test: z.boolean(),
  cancelled: z.boolean(),
  lines: z.array(
    z.object({
      lineNo: z.number().int(),
      sku: z.string().nullable(),
      description: z.string().max(120),
      quantity: z.number().int(),
      priceOre: z.number().int(),
    }),
  ),
})
export type OrderEvidence = z.infer<typeof orderEvidence>

/** The minimized evidence for one order; the line currency is the order's, mixed currencies stop the page. */
export function orderToEvidence(order: OrderNode): OrderEvidence {
  const currencies = new Set(
    order.lineItems.nodes.map(
      (l) => l.discountedTotalSet.shopMoney.currencyCode,
    ),
  )
  if (currencies.size > 1) throw new Error('SHOPIFY_CURRENCY_MIXED')
  const lines = order.lineItems.nodes.map((l, i) => ({
    lineNo: i + 1,
    sku: l.sku && l.sku.length <= 200 ? l.sku : null,
    description: l.title.slice(0, 120),
    quantity: l.quantity,
    priceOre: toOre(l.discountedTotalSet.shopMoney.amount),
  }))
  if (lines.length === 0) throw new Error('SHOPIFY_ORDER_EMPTY')
  return orderEvidence.parse({
    orderGid: order.id,
    name: order.name,
    occurredAt: new Date(order.createdAt).toISOString(),
    updatedAt: new Date(order.updatedAt).toISOString(),
    currency: [...currencies][0] ?? 'SEK',
    amountOre: lines.reduce((s, l) => s + l.priceOre, 0),
    financialStatus: order.displayFinancialStatus ?? 'UNKNOWN',
    test: order.test,
    cancelled: order.cancelledAt !== null,
    lines,
  })
}

/** The next watermark: the newest update on the page, else the one we asked from. */
export function nextCursor(orders: OrderEvidence[], since: string) {
  return orders.reduce(
    (max, o) => (Date.parse(o.updatedAt) > Date.parse(max) ? o.updatedAt : max),
    since,
  )
}
