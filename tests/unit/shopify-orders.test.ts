import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import {
  nextCursor,
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

describe('order evidence', () => {
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
    return new Response(
      JSON.stringify({
        data: { orders: { nodes: options.orders ?? [order()] } },
      }),
      { status: 200 },
    )
  })
  const client = { rpc, from } as unknown as SupabaseClient
  const run = () =>
    pullShopifyOrders(
      client,
      { tenantId: tenant, requestId: request },
      options.acceptTest ? { ...env, SHOPIFY_ACCEPT_TEST_ORDERS: 'true' } : env,
      http as unknown as typeof fetch,
    )
  return { run, pages, requests }
}

describe('pullShopifyOrders', () => {
  it('asks for paid orders since the watermark and records the page on top of it', async () => {
    const s = setup()
    const r = await s.run()
    expect(r).toEqual({
      id: request,
      received: 1,
      cursor: '2026-09-15T11:05:00.000Z',
    })
    expect(JSON.parse(s.requests[0]).variables.q).toBe(
      `financial_status:paid updated_at:>='${since}'`,
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
