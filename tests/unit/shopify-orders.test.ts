import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import {
  nextCursor,
  listPaidOrders,
  orderToEvidence,
  toOre,
  type OrderNode,
} from '../../extensions/shopify/orders'
import { pullShopifyOrders } from '../../lib/engine/shopify-orders'

const tenant = '10000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001',
  request = '40000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  SHOPIFY_CLIENT_ID: 'synthetic-client',
  SHOPIFY_CLIENT_SECRET: 'synthetic-secret',
  SHOPIFY_PILOT_TENANT_ID: tenant,
}
const shop = 'komisio-test.myshopify.com'
const since = '2026-09-15T10:00:00.000Z'
const money = (amount: string, currencyCode = 'SEK') => ({
  shopMoney: { amount, currencyCode },
})
const order = (over: Partial<OrderNode> = {}): OrderNode => ({
  id: 'gid://shopify/Order/1',
  name: '#1001',
  createdAt: '2026-09-15T11:00:00Z',
  updatedAt: '2026-09-15T11:05:00Z',
  displayFinancialStatus: 'PAID',
  test: false,
  cancelledAt: null,
  lineItems: {
    nodes: [
      {
        sku: `K-${item}`,
        title: 'Synthetic jacket',
        quantity: 1,
        discountedTotalSet: money('250.00'),
      },
    ],
  },
  ...over,
})

const completeOrder = (value = order()) => ({
  ...value,
  lineItems: { ...value.lineItems, pageInfo: { hasNextPage: false } },
  refunds: (value.refunds ?? []).map((refund) => ({
    ...refund,
    refundLineItems: {
      ...refund.refundLineItems,
      pageInfo: { hasNextPage: false },
    },
  })),
})
const orderPage = (
  nodes: unknown[],
  more = false,
  cursor: string | null = null,
) =>
  Response.json({
    data: {
      orders: { nodes, pageInfo: { hasNextPage: more, endCursor: cursor } },
    },
  })

describe('Shopify order read contract', () => {
  it('uses the documented refund list and requests completeness markers', async () => {
    const http = vi.fn(async (_url, init) => {
      const { query } = JSON.parse(String(init?.body))
      expect(query).not.toMatch(/refunds\s*\(/)
      expect(query).toContain('refunds {')
      expect(query.match(/hasNextPage/g)).toHaveLength(3)
      return orderPage([completeOrder()])
    })
    expect(await listPaidOrders(shop, 'synthetic', since, http)).toHaveLength(1)
  })

  it('reduces rejected query cost and follows provider cursors without skipping orders', async () => {
    const seen: Array<{ first: number; after: string | null }> = []
    const http = vi.fn(async (_url, init) => {
      const { variables } = JSON.parse(String(init?.body))
      seen.push(variables)
      if (variables.first > 12)
        return Response.json({
          errors: [
            {
              message: 'synthetic cost rejection',
              extensions: { code: 'MAX_COST_EXCEEDED' },
            },
          ],
        })
      return variables.after === null
        ? orderPage([completeOrder()], true, 'cursor-one')
        : orderPage([completeOrder(order({ id: 'gid://shopify/Order/2' }))])
    })
    expect(await listPaidOrders(shop, 'synthetic', since, http)).toHaveLength(2)
    expect(seen.map((v) => v.first)).toEqual([50, 25, 12, 12])
    expect(seen.map((v) => v.after)).toEqual([null, null, null, 'cursor-one'])
  })

  it('does not return a partial page when a later read fails', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(orderPage([completeOrder()], true, 'cursor-one'))
      .mockResolvedValueOnce(
        Response.json({
          errors: [
            { message: 'private error', extensions: { code: 'ACCESS_DENIED' } },
          ],
        }),
      )
    await expect(
      listPaidOrders(shop, 'synthetic', since, http),
    ).rejects.toThrow('SHOPIFY_READ_FAILED')
  })

  it('preserves the engine page size when smaller provider batches are required', async () => {
    let offset = 0
    const http = vi.fn(async (_url, init) => {
      const { variables } = JSON.parse(String(init?.body))
      if (variables.first > 12)
        return Response.json({
          errors: [
            { message: 'cost', extensions: { code: 'MAX_COST_EXCEEDED' } },
          ],
        })
      expect(variables.after).toBe(offset ? `cursor-${offset}` : null)
      const nodes = Array.from({ length: variables.first }, () =>
        completeOrder(order({ id: `gid://shopify/Order/${++offset}` })),
      )
      return orderPage(nodes, true, `cursor-${offset}`)
    })
    const result = await listPaidOrders(shop, 'synthetic', since, http)
    expect(result).toHaveLength(50)
    expect(new Set(result.map((o) => o.id)).size).toBe(50)
    expect(offset).toBe(50)
  })

  it('bounds cost retries and does not retry throttling or access failures', async () => {
    for (const [code, calls, error] of [
      ['MAX_COST_EXCEEDED', 6, 'SHOPIFY_READ_FAILED'],
      ['THROTTLED', 1, 'SHOPIFY_RATE_LIMITED'],
      ['ACCESS_DENIED', 1, 'SHOPIFY_READ_FAILED'],
    ] as const) {
      const http = vi.fn(async () =>
        Response.json({
          errors: [{ message: 'private', extensions: { code } }],
        }),
      )
      await expect(
        listPaidOrders(shop, 'synthetic', since, http),
      ).rejects.toThrow(error)
      expect(http).toHaveBeenCalledTimes(calls)
    }
  })

  it('refuses duplicate orders and broken continuation cursors', async () => {
    for (const pages of [
      [orderPage([completeOrder(), completeOrder()])],
      [orderPage([completeOrder()], true, null)],
      [orderPage([], true, 'cursor-one')],
      [
        orderPage([completeOrder()], true, 'cursor-one'),
        orderPage([completeOrder()]),
      ],
      [
        orderPage([completeOrder()], true, 'cursor-one'),
        orderPage(
          [completeOrder(order({ id: 'gid://shopify/Order/2' }))],
          true,
          'cursor-one',
        ),
      ],
    ]) {
      const http = vi.fn(async () => {
        const page = pages.shift()
        if (!page) throw new Error('unexpected request')
        return page
      })
      await expect(
        listPaidOrders(shop, 'synthetic', since, http),
      ).rejects.toThrow('SHOPIFY_READ_FAILED')
      expect(pages).toHaveLength(0)
    }
  })

  it('refuses truncated order lines and refund lines', async () => {
    const original = completeOrder()
    const refund = {
      id: 'gid://shopify/Refund/1',
      createdAt: original.updatedAt,
      totalRefundedSet: money('250.00'),
      refundLineItems: { nodes: [], pageInfo: { hasNextPage: true } },
    }
    for (const value of [
      {
        ...original,
        lineItems: { ...original.lineItems, pageInfo: { hasNextPage: true } },
      },
      { ...original, refunds: [refund] },
    ]) {
      await expect(
        listPaidOrders(shop, 'synthetic', since, async () =>
          orderPage([value]),
        ),
      ).rejects.toThrow('SHOPIFY_READ_FAILED')
    }
  })
})

describe('order evidence', () => {
  it('retains variant identity on sales and refunds without rewriting the source SKU', () => {
    const original = order()
    const variant = { id: 'gid://shopify/ProductVariant/321' }
    const evidence = orderToEvidence({
      ...original,
      lineItems: {
        nodes: [{ ...original.lineItems.nodes[0], sku: 'OLD-321', variant }],
      },
      refunds: [
        {
          id: 'gid://shopify/Refund/321',
          createdAt: '2026-09-15T12:00:00Z',
          totalRefundedSet: money('250.00'),
          refundLineItems: {
            nodes: [
              {
                lineItem: { sku: 'OLD-321', variant },
                quantity: 1,
                subtotalSet: money('200.00'),
                totalTaxSet: money('50.00'),
              },
            ],
          },
        },
      ],
    })
    expect(evidence.lines[0]).toMatchObject({
      sku: 'OLD-321',
      variantGid: variant.id,
    })
    expect(evidence.refunds?.[0].lines[0]).toMatchObject({
      sku: 'OLD-321',
      variantGid: variant.id,
      amountOre: 25000,
    })
  })
  it('retains POS channel and location on discounted checkout evidence', () => {
    const e = orderToEvidence(
      order({
        sourceName: 'pos',
        retailLocation: { id: 'gid://shopify/Location/1' },
        lineItems: {
          nodes: [
            {
              sku: 'K-' + item,
              title: 'Discounted',
              quantity: 1,
              discountedTotalSet: money('199.00'),
            },
          ],
        },
      }),
    )
    expect(e).toMatchObject({
      sourceName: 'pos',
      retailLocationGid: 'gid://shopify/Location/1',
      amountOre: 19900,
    })
  })
  it('parses decimal amounts as öre', () => {
    expect(toOre('250.00')).toBe(25000)
    expect(toOre('0.5')).toBe(50)
    expect(toOre('19')).toBe(1900)
    expect(toOre('-3.25')).toBe(-325)
    expect(() => toOre('1e3')).toThrow('SHOPIFY_AMOUNT_INVALID')
    expect(() => toOre('1.234')).toThrow('SHOPIFY_AMOUNT_INVALID')
  })
  it('reduces an order to lines with sku and line total', () => {
    const e = orderToEvidence(order())
    expect(e).toMatchObject({
      orderGid: 'gid://shopify/Order/1',
      name: '#1001',
      occurredAt: '2026-09-15T11:00:00.000Z',
      updatedAt: '2026-09-15T11:05:00.000Z',
      currency: 'SEK',
      amountOre: 25000,
      financialStatus: 'PAID',
      test: false,
      cancelled: false,
      lines: [
        {
          lineNo: 1,
          sku: `K-${item}`,
          description: 'Synthetic jacket',
          quantity: 1,
          priceOre: 25000,
        },
      ],
    })
    expect(
      orderToEvidence(order({ cancelledAt: '2026-09-15T12:00:00Z' })).cancelled,
    ).toBe(true)
  })
  it('stops on mixed currencies and empty orders', () => {
    expect(() =>
      orderToEvidence(
        order({
          lineItems: {
            nodes: [
              {
                sku: 'a',
                title: 'a',
                quantity: 1,
                discountedTotalSet: money('1.00'),
              },
              {
                sku: 'b',
                title: 'b',
                quantity: 1,
                discountedTotalSet: money('1.00', 'EUR'),
              },
            ],
          },
        }),
      ),
    ).toThrow('SHOPIFY_CURRENCY_MIXED')
    expect(() => orderToEvidence(order({ lineItems: { nodes: [] } }))).toThrow(
      'SHOPIFY_ORDER_EMPTY',
    )
  })
  it('moves the watermark to the newest update on the page', () => {
    const a = orderToEvidence(order())
    const b = orderToEvidence(
      order({ id: 'gid://shopify/Order/2', updatedAt: '2026-09-15T13:00:00Z' }),
    )
    expect(nextCursor([a, b], since)).toBe('2026-09-15T13:00:00.000Z')
    expect(nextCursor([], since)).toBe(since)
  })
})

function setup(
  options: { prior?: boolean; orders?: OrderNode[]; acceptTest?: boolean } = {},
) {
  const cipher = seal(
    'shopify-connection',
    { accessToken: 'shpat_synthetic', refreshToken: null },
    env,
  )
  const pages: Record<string, unknown>[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'tenant_role') return { data: 'owner', error: null }
    if (name === 'read_shopify_connection')
      return {
        data: {
          shopDomain: shop,
          shopName: 'Komisio Test',
          currency: 'SEK',
          cipher,
          scope: 'read_orders',
          expiresAt: null,
          revision: '1',
        },
        error: null,
      }
    if (name === 'shopify_order_cursor') return { data: since, error: null }
    if (name === 'record_shopify_order_page') {
      pages.push(args)
      return { data: args.p_id, error: null }
    }
    return { data: null, error: { message: `UNEXPECTED_${name}` } }
  })
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: options.prior
              ? { cursor_before: since, cursor_after: 'X', page: [] }
              : null,
            error: null,
          }),
        }),
      }),
    }),
  }))
  const requests: string[] = []
  const http = vi.fn(async (_input: unknown, init?: RequestInit) => {
    requests.push(String(init?.body ?? ''))
    return orderPage((options.orders ?? [order()]).map(completeOrder))
  })
  const client = { rpc, from } as unknown as SupabaseClient
  const run = () =>
    pullShopifyOrders(
      client,
      { tenantId: tenant, requestId: request },
      options.acceptTest ? { ...env, SHOPIFY_ACCEPT_TEST_ORDERS: 'true' } : env,
      http as unknown as typeof fetch,
    )
  return { run, pages, requests, http }
}

describe('pullShopifyOrders', () => {
  it('does not record sales or move the cursor after a later provider batch fails', async () => {
    const s = setup()
    s.http
      .mockResolvedValueOnce(orderPage([completeOrder()], true, 'cursor-one'))
      .mockResolvedValueOnce(
        Response.json({ errors: [{ message: 'private' }] }),
      )
    await expect(s.run()).rejects.toThrow('SHOPIFY_READ_FAILED')
    expect(s.pages).toEqual([])
  })
  it('asks for paid orders since the watermark and records the page on top of it', async () => {
    const s = setup()
    const r = await s.run()
    expect(r).toEqual({
      id: request,
      received: 1,
      cursor: '2026-09-15T11:05:00.000Z',
    })
    expect(JSON.parse(s.requests[0]).variables.q).toBe(
      `(financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded) updated_at:>='${since}'`,
    )
    expect(s.pages[0]).toMatchObject({
      p_tenant: tenant,
      p_id: request,
      p_before: since,
      p_after: '2026-09-15T11:05:00.000Z',
    })
    expect((s.pages[0].p_orders as unknown[]).length).toBe(1)
    expect(s.pages[0].p_accept_test).toBe(false)
  })
  it('tells the engine when the deployment accepts test orders', async () => {
    const s = setup({ acceptTest: true })
    await s.run()
    expect(s.pages[0].p_accept_test).toBe(true)
  })
  it('keeps the watermark on an empty page', async () => {
    const s = setup({ orders: [] })
    expect(await s.run()).toEqual({ id: request, received: 0, cursor: since })
    expect(s.pages[0]).toMatchObject({ p_before: since, p_after: since })
  })
  it('replays a known request id from the stored page without calling Shopify', async () => {
    const s = setup({ prior: true })
    expect(await s.run()).toEqual({ id: request, replayed: true })
    expect(s.requests).toHaveLength(0)
    expect(s.pages[0]).toMatchObject({
      p_before: since,
      p_after: 'X',
      p_orders: [],
    })
  })
})
