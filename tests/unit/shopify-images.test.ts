import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import { exportShopifyItem } from '../../lib/engine/shopify-products'
import {
  orderToEvidence,
  type OrderNode,
} from '../../extensions/shopify/orders'

const tenant = '10000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001',
  session = '20000000-0000-4000-8000-000000000001',
  photo = '60000000-0000-4000-8000-000000000001',
  request = '40000000-0000-4000-8000-000000000001',
  exportId = '50000000-0000-4000-8000-000000000001',
  intent = '70000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  SHOPIFY_CLIENT_ID: 'synthetic-client',
  SHOPIFY_CLIENT_SECRET: 'synthetic-secret',
  SHOPIFY_PILOT_TENANT_ID: tenant,
}
const shop = 'komisio-test.myshopify.com'
const payload = {
  title: 'Synthetic jacket',
  category: 'Jackets',
  sku: `K-${item}`,
  reference: 'I-30000000',
  price: '250.00',
  currency: 'SEK',
  quantity: 1,
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

async function setup(
  options: {
    photo?: 'none' | 'fresh' | 'synced'
    uploadFails?: boolean
    mediaRejected?: boolean
  } = {},
) {
  const cipher = seal(
    'shopify-connection',
    { accessToken: 'shpat_old', refreshToken: null },
    env,
  )
  const bytes = await sharp({
    create: { width: 120, height: 90, channels: 3, background: '#a03030' },
  })
    .jpeg()
    .toBuffer()
  const calls: [string, Record<string, unknown>][] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args])
    if (name === 'tenant_role') return { data: 'owner', error: null }
    if (name === 'read_shopify_connection')
      return {
        data: {
          shopDomain: shop,
          shopName: 'Komisio Test',
          currency: 'SEK',
          cipher,
          scope: 'write_products',
          expiresAt: null,
          revision: '1',
        },
        error: null,
      }
    if (name === 'prepare_shopify_product')
      return { data: exportId, error: null }
    if (name === 'finish_shopify_product')
      return { data: exportId, error: null }
    if (name === 'prepare_shopify_image')
      return {
        data:
          (options.photo ?? 'fresh') === 'none'
            ? null
            : {
                id: intent,
                fresh: options.photo !== 'synced',
                reference: `${tenant}/${session}/${photo}.jpg`,
                productGid: 'gid://shopify/Product/1',
                mediaGid:
                  options.photo === 'synced'
                    ? 'gid://shopify/MediaImage/5'
                    : null,
              },
        error: null,
      }
    if (name === 'record_shopify_image_result')
      return { data: null, error: null }
    return { data: null, error: { message: `UNEXPECTED_${name}` } }
  })
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: { payload, product_gid: null },
            error: null,
          }),
        }),
      }),
    }),
  }))
  const download = vi.fn(async () => ({
    data: new Blob([bytes], { type: 'image/jpeg' }),
    error: null,
  }))
  const storage = { from: () => ({ download }) }
  const requests: { url: string; body: unknown; graphql: string }[] = []
  const http = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body
      const text = typeof body === 'string' ? body : ''
      requests.push({ url, body, graphql: text })
      if (url === 'https://uploads.example/target') {
        expect(body).toBeInstanceOf(FormData)
        const form = body as FormData
        expect(form.get('key')).toBe('tmp/1/abc')
        expect((form.get('file') as Blob).size).toBeGreaterThan(100)
        return options.uploadFails
          ? new Response('no', { status: 403 })
          : new Response('', { status: 201 })
      }
      if (text.includes('locations(first'))
        return json({
          data: {
            locations: {
              edges: [
                {
                  node: {
                    id: 'gid://shopify/Location/2',
                    name: 'Shop',
                    isActive: true,
                    fulfillsOnlineOrders: true,
                  },
                },
              ],
            },
          },
        })
      if (text.includes('productVariants(first'))
        return json({ data: { productVariants: { nodes: [] } } })
      if (text.includes('productSet('))
        return json({
          data: {
            productSet: {
              product: {
                id: 'gid://shopify/Product/1',
                variants: {
                  nodes: [
                    {
                      id: 'gid://shopify/ProductVariant/1',
                      sku: payload.sku,
                      inventoryItem: { id: 'gid://shopify/InventoryItem/1' },
                    },
                  ],
                },
              },
              userErrors: [],
            },
          },
        })
      if (text.includes('stagedUploadsCreate('))
        return json({
          data: {
            stagedUploadsCreate: {
              stagedTargets: [
                {
                  url: 'https://uploads.example/target',
                  resourceUrl: 'https://uploads.example/tmp/1/abc',
                  parameters: [{ name: 'key', value: 'tmp/1/abc' }],
                },
              ],
              userErrors: [],
            },
          },
        })
      if (text.includes('productCreateMedia('))
        return options.mediaRejected
          ? json({
              data: {
                productCreateMedia: {
                  media: [],
                  mediaUserErrors: [{ message: 'bad image' }],
                },
              },
            })
          : json({
              data: {
                productCreateMedia: {
                  media: [
                    { id: 'gid://shopify/MediaImage/5', status: 'UPLOADED' },
                  ],
                  mediaUserErrors: [],
                },
              },
            })
      return json({ errors: [{ message: 'unexpected' }] }, 400)
    },
  )
  const client = { rpc, from, storage } as unknown as SupabaseClient
  const run = () =>
    exportShopifyItem(
      client,
      { tenantId: tenant, requestId: request, itemId: item },
      env,
      http as unknown as typeof fetch,
    )
  return { run, calls, requests, download }
}

describe('product image after export', () => {
  it('uploads the reception photo through a staged upload and attaches it once', async () => {
    const s = await setup()
    const r = await s.run()
    expect(r.image).toBe('synced')
    expect(s.download).toHaveBeenCalledWith(`${tenant}/${session}/${photo}.jpg`)
    const media = s.requests.find((q) =>
      q.graphql.includes('productCreateMedia('),
    )!
    expect(JSON.parse(media.graphql).variables).toMatchObject({
      productId: 'gid://shopify/Product/1',
      media: [
        {
          originalSource: 'https://uploads.example/tmp/1/abc',
          mediaContentType: 'IMAGE',
          alt: 'Synthetic jacket',
        },
      ],
    })
    expect(
      s.calls.find(([n]) => n === 'record_shopify_image_result')![1],
    ).toMatchObject({
      p_intent: intent,
      p_media_gid: 'gid://shopify/MediaImage/5',
      p_error: null,
    })
  })
  it('reports no image for an item without a reception photo', async () => {
    const s = await setup({ photo: 'none' })
    expect((await s.run()).image).toBe('none')
    expect(s.download).not.toHaveBeenCalled()
  })
  it('does not upload again once Shopify holds the image', async () => {
    const s = await setup({ photo: 'synced' })
    expect((await s.run()).image).toBe('synced')
    expect(s.download).not.toHaveBeenCalled()
    expect(
      s.requests.some((q) => q.graphql.includes('stagedUploadsCreate(')),
    ).toBe(false)
  })
  it('records a fixed failure code and keeps the product export synced', async () => {
    const s = await setup({ uploadFails: true })
    const r = await s.run()
    expect(r.status).toBe('synced')
    expect(r.image).toBe('failed')
    expect(
      s.calls.find(([n]) => n === 'record_shopify_image_result')![1],
    ).toMatchObject({
      p_media_gid: null,
      p_error: 'SHOPIFY_UPLOAD_FAILED',
    })
    const rejected = await setup({ mediaRejected: true })
    expect((await rejected.run()).image).toBe('failed')
    expect(
      rejected.calls.find(([n]) => n === 'record_shopify_image_result')![1],
    ).toMatchObject({
      p_error: 'SHOPIFY_IMAGE_REJECTED',
    })
  })
})

describe('refund evidence', () => {
  it('carries each refund with its lines and the tax-inclusive refunded amount', () => {
    const order: OrderNode = {
      id: 'gid://shopify/Order/1',
      name: '#1001',
      createdAt: '2026-09-15T11:00:00Z',
      updatedAt: '2026-09-15T12:00:00Z',
      displayFinancialStatus: 'REFUNDED',
      test: false,
      cancelledAt: null,
      refunds: [
        {
          id: 'gid://shopify/Refund/7',
          createdAt: '2026-09-15T12:00:00Z',
          totalRefundedSet: {
            shopMoney: { amount: '250.00', currencyCode: 'SEK' },
          },
          refundLineItems: {
            nodes: [
              {
                lineItem: { sku: `K-${item}` },
                quantity: 1,
                subtotalSet: {
                  shopMoney: { amount: '200.00', currencyCode: 'SEK' },
                },
                totalTaxSet: {
                  shopMoney: { amount: '50.00', currencyCode: 'SEK' },
                },
              },
            ],
          },
        },
      ],
      lineItems: {
        nodes: [
          {
            sku: `K-${item}`,
            title: 'Jacket',
            quantity: 1,
            discountedTotalSet: {
              shopMoney: { amount: '250.00', currencyCode: 'SEK' },
            },
          },
        ],
      },
    }
    expect(orderToEvidence(order).refunds).toEqual([
      {
        refundGid: 'gid://shopify/Refund/7',
        occurredAt: '2026-09-15T12:00:00.000Z',
        amountOre: 25000,
        lines: [{ lineNo: 1, sku: `K-${item}`, quantity: 1, amountOre: 25000 }],
      },
    ])
  })
})
