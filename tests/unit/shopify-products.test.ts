import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import {
  chooseLocation,
  productSetInput,
} from '../../extensions/shopify/products'
import { exportShopifyItem } from '../../lib/engine/shopify-products'

const tenant = '10000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001',
  request = '40000000-0000-4000-8000-000000000001',
  exportId = '50000000-0000-4000-8000-000000000001'
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

function setup(
  options: {
    syncSettings?: unknown
    publicationError?: boolean
    extraVariant?: boolean
    expired?: boolean
    refreshToken?: string | null
    knownProduct?: string | null
    existingSku?: boolean
    locations?: unknown[]
    userError?: string
    lostAnswer?: boolean
    revisionChanged?: boolean
  } = {},
) {
  const cipher = seal(
    'shopify-connection',
    {
      accessToken: 'shpat_old',
      refreshToken:
        options.refreshToken === undefined ? 'shprt_old' : options.refreshToken,
    },
    env,
  )
  const outcomes: unknown[] = []
  const calls: string[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(name)
    if (name === 'tenant_role') return { data: 'owner', error: null }
    if (name === 'read_shopify_connection')
      return {
        data: {
          shopDomain: shop,
          shopName: 'Komisio Test',
          currency: 'SEK',
          cipher,
          scope: 'write_products',
          expiresAt: new Date(
            Date.now() + (options.expired ? -1000 : 3600_000),
          ).toISOString(),
          revision: '7',
        },
        error: null,
      }
    if (name === 'refresh_shopify_tokens')
      return {
        data: options.revisionChanged
          ? { error: 'SHOPIFY_CONNECTION_CHANGED' }
          : { status: 'refreshed', revision: '8' },
        error: null,
      }
    if (name === 'prepare_shopify_product')
      return { data: exportId, error: null }
    if (name === 'finish_shopify_product') {
      outcomes.push(args)
      return { data: exportId, error: null }
    }
    return { data: null, error: { message: `UNEXPECTED_${name}` } }
  })
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              payload: { ...payload, syncSettings: options.syncSettings },
              product_gid: options.knownProduct ?? null,
            },
            error: null,
          }),
        }),
      }),
    }),
  }))
  const requests: { url: string; body: string; token: string | null }[] = []
  const http = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = String(init?.body ?? '')
      const headers = new Headers(init?.headers)
      requests.push({ url, body, token: headers.get('X-Shopify-Access-Token') })
      if (url.endsWith('/admin/oauth/access_token'))
        return json({
          access_token: 'shpat_new',
          scope: 'write_products',
          expires_in: 3600,
          refresh_token: 'shprt_new',
        })
      if (body.includes('locations(first'))
        return json({
          data: {
            locations: {
              edges: (
                options.locations ?? [
                  {
                    id: 'gid://shopify/Location/1',
                    name: 'Warehouse',
                    isActive: true,
                    fulfillsOnlineOrders: false,
                  },
                  {
                    id: 'gid://shopify/Location/2',
                    name: 'Shop',
                    isActive: true,
                    fulfillsOnlineOrders: true,
                  },
                ]
              ).map((node) => ({ node })),
            },
          },
        })
      if (body.includes('productVariants(first'))
        return json({
          data: {
            productVariants: {
              nodes:
                options.existingSku || options.knownProduct
                  ? [
                      {
                        id: 'gid://shopify/ProductVariant/9',
                        sku: payload.sku,
                        product: {
                          id: options.knownProduct ?? 'gid://shopify/Product/9',
                          variants: {
                            nodes: [
                              { id: 'gid://shopify/ProductVariant/9' },
                              ...(options.extraVariant
                                ? [{ id: 'gid://shopify/ProductVariant/10' }]
                                : []),
                            ],
                          },
                        },
                        inventoryItem: { id: 'gid://shopify/InventoryItem/9' },
                      },
                    ]
                  : [],
            },
          },
        })
      if (body.includes('publishablePublish'))
        return json({
          data: {
            publishablePublish: {
              userErrors: options.publicationError
                ? [{ message: 'Denied' }]
                : [],
            },
          },
        })
      if (body.includes('productSet(')) {
        if (options.lostAnswer) throw new TypeError('socket hang up')
        if (options.userError)
          return json({
            data: {
              productSet: {
                product: null,
                userErrors: [
                  {
                    field: ['input'],
                    message: options.userError,
                    code: 'INVALID',
                  },
                ],
              },
            },
          })
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
      }
      return json({ errors: [{ message: 'unexpected' }] }, 400)
    },
  )
  const client = { rpc, from } as unknown as SupabaseClient
  const run = () =>
    exportShopifyItem(
      client,
      { tenantId: tenant, requestId: request, itemId: item },
      env,
      http as unknown as typeof fetch,
    )
  return { run, calls, outcomes, requests }
}

describe('productSet input', () => {
  it('builds one default variant with the sku, price and one tracked unit at the location', () => {
    const v = productSetInput(payload, 'gid://shopify/Location/2', null)
    expect(v.identifier).toBeNull()
    expect(v.input).toMatchObject({
      title: 'Synthetic jacket',
      status: 'ACTIVE',
      productType: 'Jackets',
      variants: [
        {
          sku: payload.sku,
          price: '250.00',
          inventoryPolicy: 'DENY',
          inventoryItem: { tracked: true },
          inventoryQuantities: [
            {
              locationId: 'gid://shopify/Location/2',
              name: 'available',
              quantity: 1,
            },
          ],
        },
      ],
    })
    expect(
      productSetInput(
        payload,
        'x',
        'gid://shopify/Product/1',
        'gid://shopify/ProductVariant/9',
      ).identifier,
    ).toEqual({ id: 'gid://shopify/Product/1' })
  })
  it('prefers the active location that fulfils online orders', () => {
    expect(
      chooseLocation([
        { id: 'a', name: 'a', isActive: false, fulfillsOnlineOrders: true },
        { id: 'b', name: 'b', isActive: true, fulfillsOnlineOrders: false },
        { id: 'c', name: 'c', isActive: true, fulfillsOnlineOrders: true },
      ])?.id,
    ).toBe('c')
    expect(chooseLocation([])).toBeNull()
  })
})

describe('exportShopifyItem', () => {
  const config = {
    mode: 'pos',
    locationId: 'gid://shopify/Location/1',
    locationName: 'Warehouse',
    webPublicationId: null,
    posPublicationId: 'gid://shopify/Publication/2',
  }
  it('uses the recorded location and publishes to the selected POS channel', async () => {
    const s = setup({ syncSettings: config })
    await s.run()
    const product = JSON.parse(
      s.requests.find((r) => r.body.includes('productSet('))!.body,
    ).variables.input.variants[0]
    expect(product.barcode).toBe(payload.reference)
    expect(product.inventoryQuantities[0].locationId).toBe(config.locationId)
    expect(
      JSON.parse(
        s.requests.find((r) => r.body.includes('publishablePublish'))!.body,
      ).variables.input,
    ).toEqual([{ publicationId: config.posPublicationId }])
  })
  it.each([{ knownProduct: 'gid://shopify/Product/1' }, { existingSku: true }])(
    'never replenishes an existing or recovered product',
    async (options) => {
      const s = setup({ ...options, syncSettings: config })
      await s.run()
      const product = JSON.parse(
        s.requests.find((r) => r.body.includes('productSet('))!.body,
      ).variables.input.variants[0]
      expect(product).not.toHaveProperty('inventoryQuantities')
      expect(product.id).toBe('gid://shopify/ProductVariant/9')
    },
  )
  it('refuses products with extra variants instead of removing their stock', async () => {
    const s = setup({ existingSku: true, extraVariant: true })
    await expect(s.run()).rejects.toThrow('SHOPIFY_SKU_AMBIGUOUS')
    expect(s.requests.some((r) => r.body.includes('productSet('))).toBe(false)
  })
  it('records uncertain export if publication fails after product creation', async () => {
    const s = setup({ syncSettings: config, publicationError: true })
    await expect(s.run()).rejects.toThrow('SHOPIFY_PUBLICATION_FAILED')
    expect(s.outcomes).toEqual([
      expect.objectContaining({
        p_status: 'unknown',
        p_error: 'SHOPIFY_PUBLICATION_FAILED',
      }),
    ])
  })
  it('does not fall back to a different active warehouse', async () => {
    const s = setup({
      syncSettings: { ...config, locationId: 'gid://shopify/Location/999' },
    })
    await expect(s.run()).rejects.toThrow('SHOPIFY_NO_LOCATION')
    expect(s.requests.some((r) => r.body.includes('productSet('))).toBe(false)
  })
  it('creates the product and records the synced outcome with the ids', async () => {
    const s = setup()
    const r = await s.run()
    expect(r).toMatchObject({
      exportId,
      status: 'synced',
      productGid: 'gid://shopify/Product/1',
      updated: false,
    })
    expect(s.outcomes).toEqual([
      expect.objectContaining({
        p_status: 'synced',
        p_error: null,
        p_product_gid: 'gid://shopify/Product/1',
        p_variant_gid: 'gid://shopify/ProductVariant/1',
        p_inventory_item_gid: 'gid://shopify/InventoryItem/1',
      }),
    ])
    const set = s.requests.find((q) => q.body.includes('productSet('))!
    expect(set.token).toBe('shpat_old')
    expect(JSON.parse(set.body).variables.identifier).toBeNull()
    expect(
      JSON.parse(set.body).variables.input.variants[0].inventoryQuantities[0]
        .locationId,
    ).toBe('gid://shopify/Location/2')
    expect(s.calls).not.toContain('refresh_shopify_tokens')
  })
  it('updates the known product instead of creating another', async () => {
    const s = setup({ knownProduct: 'gid://shopify/Product/1' })
    const r = await s.run()
    expect(r.updated).toBe(true)
    expect(
      s.requests.some((q) => q.body.includes('productVariants(first')),
    ).toBe(true)
    const set = s.requests.find((q) => q.body.includes('productSet('))!
    expect(JSON.parse(set.body).variables.identifier).toEqual({
      id: 'gid://shopify/Product/1',
    })
  })
  it('reconciles by sku after a lost answer: an existing variant means update', async () => {
    const s = setup({ existingSku: true })
    const r = await s.run()
    expect(r.updated).toBe(true)
    const set = s.requests.find((q) => q.body.includes('productSet('))!
    expect(JSON.parse(set.body).variables.identifier).toEqual({
      id: 'gid://shopify/Product/9',
    })
  })
  it('records unknown when the answer is lost, so nothing is created twice', async () => {
    const s = setup({ lostAnswer: true })
    await expect(s.run()).rejects.toThrow('SHOPIFY_CONNECTION_FAILED')
    expect(s.outcomes).toEqual([
      expect.objectContaining({
        p_status: 'unknown',
        p_error: 'SHOPIFY_CONNECTION_FAILED',
      }),
    ])
  })
  it('records failed when Shopify refuses the product', async () => {
    const s = setup({ userError: 'Title cannot be blank' })
    await expect(s.run()).rejects.toThrow('SHOPIFY_PRODUCT_REJECTED')
    expect(s.outcomes).toEqual([
      expect.objectContaining({
        p_status: 'failed',
        p_error: 'SHOPIFY_PRODUCT_REJECTED',
      }),
    ])
  })
  it('records failed before any request when the shop has no active location', async () => {
    const s = setup({
      locations: [
        { id: 'x', name: 'x', isActive: false, fulfillsOnlineOrders: true },
      ],
    })
    await expect(s.run()).rejects.toThrow('SHOPIFY_NO_LOCATION')
    expect(s.outcomes).toEqual([
      expect.objectContaining({
        p_status: 'failed',
        p_error: 'SHOPIFY_NO_LOCATION',
      }),
    ])
    expect(s.requests.some((q) => q.body.includes('productSet('))).toBe(false)
  })
  it('renews an expired token against the connection revision before exporting', async () => {
    const s = setup({ expired: true })
    await s.run()
    expect(s.requests[0].url).toBe(`https://${shop}/admin/oauth/access_token`)
    expect(s.requests[0].body).toContain('grant_type=refresh_token')
    expect(s.requests[0].body).toContain('refresh_token=shprt_old')
    expect(s.calls).toContain('refresh_shopify_tokens')
    const set = s.requests.find((q) => q.body.includes('productSet('))!
    expect(set.token).toBe('shpat_new')
  })
  it('asks for a reconnect when the token expired without a refresh token', async () => {
    const s = setup({ expired: true, refreshToken: null })
    await expect(s.run()).rejects.toThrow('SHOPIFY_AUTH_REQUIRED')
    expect(s.requests).toHaveLength(0)
  })
  it('stops when the connection changed under the renewal', async () => {
    const s = setup({ expired: true, revisionChanged: true })
    await expect(s.run()).rejects.toThrow('SHOPIFY_CONNECTION_CHANGED')
    expect(s.outcomes).toHaveLength(0)
  })
})
