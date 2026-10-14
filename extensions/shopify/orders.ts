import { z } from 'zod'
import { graphql, ShopifyQueryCostExceeded } from './auth'

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
  sourceName: z.string().min(1).max(100).nullable().optional(),
  retailLocation: z
    .object({ id: z.string().regex(/^gid:\/\/shopify\/Location\/\d{1,30}$/) })
    .nullable()
    .optional(),
  displayFinancialStatus: z.string().nullable(),
  test: z.boolean(),
  cancelledAt: z.string().nullable(),
  refunds: z
    .array(
      z.object({
        id: z.string().regex(/^gid:\/\/shopify\/Refund\/\d{1,30}$/),
        createdAt: z.string(),
        totalRefundedSet: money,
        refundLineItems: z.object({
          nodes: z
            .array(
              z.object({
                lineItem: z.object({
                  sku: z.string().nullable(),
                  variant: z.object({ id: z.string() }).nullable().optional(),
                }),
                quantity: z.number().int(),
                subtotalSet: money,
                totalTaxSet: money,
              }),
            )
            .max(50),
        }),
      }),
    )
    .max(20)
    .default([]),
  lineItems: z.object({
    nodes: z
      .array(
        z.object({
          sku: z.string().nullable(),
          variant: z.object({ id: z.string() }).nullable().optional(),
          title: z.string(),
          quantity: z.number().int(),
          discountedTotalSet: money,
        }),
      )
      .max(50),
  }),
})
/** What a caller hands in: refunds may be absent (older fixtures, orders without refunds). */
export type OrderNode = z.input<typeof orderNode>

const ORDERS = `query PaidOrders($q: String!, $first: Int!, $after: String) {
  orders(first: $first, after: $after, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt displayFinancialStatus test cancelledAt sourceName retailLocation { id }
      lineItems(first: 50) { pageInfo { hasNextPage } nodes { sku variant { id } title quantity discountedTotalSet { shopMoney { amount currencyCode } } } }
      refunds { id createdAt totalRefundedSet { shopMoney { amount currencyCode } }
        refundLineItems(first: 50) { pageInfo { hasNextPage } nodes { lineItem { sku variant { id } } quantity subtotalSet { shopMoney { amount currencyCode } } totalTaxSet { shopMoney { amount currencyCode } } } } }
    }
  }
}`

export const PAGE_SIZE = 50

// Do not turn a truncated checkout into a smaller sale or miss a refund line.
const completeLines = z.object({
  pageInfo: z.object({ hasNextPage: z.literal(false) }),
})
const completeOrder = orderNode.and(
  z.object({
    lineItems: completeLines,
    refunds: z.array(z.object({ refundLineItems: completeLines })).max(20),
  }),
)
const pageResult = z.object({
  orders: z.object({
    nodes: z.array(completeOrder).max(PAGE_SIZE),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().min(1).nullable(),
    }),
  }),
})

/** Orders paid at some point (paid, partially refunded, refunded) updated at or after the watermark, oldest update first. */
export async function listPaidOrders(
  shop: string,
  accessToken: string,
  sinceIso: string,
  http?: typeof fetch,
): Promise<OrderNode[]> {
  const since = z.iso.datetime().parse(sinceIso)
  const orders: OrderNode[] = []
  const seenOrders = new Set<string>(),
    seenCursors = new Set<string>()
  let batchSize = PAGE_SIZE,
    after: string | null = null
  while (orders.length < PAGE_SIZE) {
    const first = Math.min(batchSize, PAGE_SIZE - orders.length)
    let data: unknown
    try {
      data = await graphql(
        shop,
        accessToken,
        ORDERS,
        {
          q: `(financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded) updated_at:>='${since}'`,
          first,
          after,
        },
        http,
      )
    } catch (e) {
      if (!(e instanceof ShopifyQueryCostExceeded) || first === 1) throw e
      batchSize = Math.max(1, Math.floor(first / 2))
      continue
    }
    const parsed = pageResult.safeParse(data)
    if (!parsed.success) throw new Error('SHOPIFY_READ_FAILED')
    const { nodes, pageInfo } = parsed.data.orders
    if (
      nodes.length > first ||
      new Set(nodes.map((o) => o.id)).size !== nodes.length ||
      nodes.some((o) => seenOrders.has(o.id))
    )
      throw new Error('SHOPIFY_READ_FAILED')
    for (const node of nodes) {
      seenOrders.add(node.id)
      orders.push(node)
    }
    if (!pageInfo.hasNextPage || orders.length === PAGE_SIZE) return orders
    if (
      !nodes.length ||
      !pageInfo.endCursor ||
      seenCursors.has(pageInfo.endCursor)
    )
      throw new Error('SHOPIFY_READ_FAILED')
    after = pageInfo.endCursor
    seenCursors.add(after)
  }
  return orders
}

/** "250.00" → 25000; refuses anything but a plain decimal with at most two places. */
export function toOre(amount: string) {
  const m = /^(-?)(\d{1,9})(?:\.(\d{1,2}))?$/.exec(amount)
  if (!m) throw new Error('SHOPIFY_AMOUNT_INVALID')
  const value = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] ? -value : value
}

export const orderEvidence = z.object({
  sourceName: z.string().nullable().optional(),
  retailLocationGid: z.string().nullable().optional(),
  orderGid: z.string(),
  name: z.string(),
  occurredAt: z.string(),
  updatedAt: z.string(),
  currency: z.string().length(3),
  amountOre: z.number().int(),
  financialStatus: z.string(),
  test: z.boolean(),
  cancelled: z.boolean(),
  refunds: z
    .array(
      z.object({
        refundGid: z.string(),
        occurredAt: z.string(),
        amountOre: z.number().int(),
        lines: z.array(
          z.object({
            lineNo: z.number().int(),
            sku: z.string().nullable(),
            variantGid: z
              .string()
              .regex(/^gid:\/\/shopify\/ProductVariant\/\d{1,30}$/)
              .optional(),
            quantity: z.number().int(),
            amountOre: z.number().int(),
          }),
        ),
      }),
    )
    .max(20),
  lines: z.array(
    z.object({
      lineNo: z.number().int(),
      sku: z.string().nullable(),
      variantGid: z
        .string()
        .regex(/^gid:\/\/shopify\/ProductVariant\/\d{1,30}$/)
        .optional(),
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
    ...(l.variant?.id ? { variantGid: l.variant.id } : {}),
    description: l.title.slice(0, 120),
    quantity: l.quantity,
    priceOre: toOre(l.discountedTotalSet.shopMoney.amount),
  }))
  if (lines.length === 0) throw new Error('SHOPIFY_ORDER_EMPTY')
  return orderEvidence.parse({
    sourceName: order.sourceName,
    retailLocationGid:
      order.retailLocation?.id ??
      (order.retailLocation === null ? null : undefined),
    orderGid: order.id,
    name: order.name,
    occurredAt: new Date(order.createdAt).toISOString(),
    updatedAt: new Date(order.updatedAt).toISOString(),
    currency: [...currencies][0],
    amountOre: lines.reduce((s, l) => s + l.priceOre, 0),
    financialStatus: order.displayFinancialStatus ?? 'UNKNOWN',
    test: order.test,
    cancelled: order.cancelledAt !== null,
    // A refund line's amount is what the customer got back for it: the
    // subtotal plus its tax, which equals the tax-inclusive line price when
    // the whole line is refunded.
    refunds: (order.refunds ?? []).map((r) => ({
      refundGid: r.id,
      occurredAt: new Date(r.createdAt).toISOString(),
      amountOre: toOre(r.totalRefundedSet.shopMoney.amount),
      lines: r.refundLineItems.nodes.map((l, i) => ({
        lineNo: i + 1,
        sku:
          l.lineItem.sku && l.lineItem.sku.length <= 200
            ? l.lineItem.sku
            : null,
        quantity: l.quantity,
        ...(l.lineItem.variant?.id
          ? { variantGid: l.lineItem.variant.id }
          : {}),
        amountOre:
          toOre(l.subtotalSet.shopMoney.amount) +
          toOre(l.totalTaxSet.shopMoney.amount),
      })),
    })),
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
