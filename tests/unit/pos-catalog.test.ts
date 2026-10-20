import { describe, expect, it, vi } from 'vitest'
import {
  paypalCatalog,
  paypalCatalogItem,
  shopifyCatalog,
  shopifyCatalogItem,
} from '../../extensions/pos-catalog'
import { canImportPosProduct } from '../../lib/pos-import'
import { storeCurrencies } from '../../lib/platform/currencies'

const merchant = '10000000-0000-4000-8000-000000000001'
const product = {
  uuid: '20000000-0000-4000-8000-000000000001',
  name: 'Jacket',
  variants: [
    {
      uuid: '30000000-0000-4000-8000-000000000001',
      name: 'Blue',
      sku: 'OLD-1',
      barcode: '0012345678901',
      price: { amount: 12525, currencyId: 'SEK' },
    },
  ],
}
const variant = {
  id: 'gid://shopify/ProductVariant/1',
  title: 'Default Title',
  sku: 'OLD-1',
  barcode: '0012345678901',
  price: '125.25',
  inventoryQuantity: 1,
  inventoryItem: { tracked: true },
  product: { id: 'gid://shopify/Product/1', title: 'Jacket', status: 'ACTIVE' },
}
const shop = 'synthetic.myshopify.com'
function response(data: unknown, headers = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('POS catalog reads', () => {
  it.each(storeCurrencies)(
    'preserves exact %s catalog prices and refuses foreign-store import',
    async (currency) => {
      const p = structuredClone(product)
      p.variants[0].price.currencyId = currency
      const http = vi.fn<typeof fetch>().mockResolvedValue(response(p))
      const row = await paypalCatalogItem(
        merchant,
        'synthetic',
        p.uuid,
        p.variants[0].uuid,
        http,
      )
      expect(row).toMatchObject({
        priceOre: 12525,
        currency,
        barcode: '0012345678901',
      })
      expect(canImportPosProduct(row!, currency)).toBe(true)
      for (const other of storeCurrencies.filter((c) => c !== currency))
        expect(canImportPosProduct(row!, other)).toBe(false)
    },
  )
  it('pins the merchant, preserves barcode zeros and consumes numeric pagination only', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ organizationUuid: merchant }))
      .mockResolvedValueOnce(
        response(
          { products: [product] },
          {
            link: '<https://untrusted.example/library?offset=50&limit=50>; rel="next"',
          },
        ),
      )
    const result = await paypalCatalog(merchant, 'synthetic', null, http)
    expect(result.next).toBe('50')
    expect(result.products[0]).toMatchObject({
      title: 'Jacket · Blue',
      barcode: '0012345678901',
      priceOre: 12525,
      quantity: null,
    })
    expect(
      http.mock.calls.every(
        ([url]) =>
          String(url).includes('.izettle.com/') ||
          String(url).includes('.zettle.com/'),
      ),
    ).toBe(true)
    expect(canImportPosProduct(result.products[0], 'SEK')).toBe(true)
  })
  it('refuses a changed merchant before reading its catalog', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ organizationUuid: product.uuid }))
    await expect(
      paypalCatalog(merchant, 'synthetic', null, http),
    ).rejects.toThrow('POS_CONNECTION_CHANGED')
    expect(http).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid cursors and non-advancing provider pagination', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ organizationUuid: merchant }))
      .mockResolvedValueOnce(
        response({ products: [] }, { link: '<?offset=0>; rel="next"' }),
      )
    await expect(
      paypalCatalog(merchant, 'synthetic', 'https://bad.test', http),
    ).rejects.toThrow()
    expect(http).not.toHaveBeenCalled()
    await expect(
      paypalCatalog(merchant, 'synthetic', null, http),
    ).rejects.toThrow('POS_READ_FAILED')
  })
  it('re-reads the exact PayPal product and variant', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(product))
    const row = await paypalCatalogItem(
      merchant,
      'synthetic',
      product.uuid,
      product.variants[0].uuid,
      http,
    )
    expect(row?.barcode).toBe('0012345678901')
    expect(String(http.mock.calls[0][0])).toContain(
      `/organizations/${merchant}/products/${product.uuid}`,
    )
    expect(
      await paypalCatalogItem(
        merchant,
        'synthetic',
        product.uuid,
        merchant,
        http,
      ),
    ).toBeNull()
  })
  it('reads Shopify variants with precise prices, identity, status and quantity', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: {
            shop: {
              id: 'gid://shopify/Shop/1',
              name: 'Synthetic',
              myshopifyDomain: shop,
              currencyCode: 'SEK',
              primaryDomain: null,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            productVariants: {
              pageInfo: { hasNextPage: true, endCursor: 'next-cursor' },
              nodes: [
                variant,
                {
                  ...variant,
                  id: 'gid://shopify/ProductVariant/2',
                  inventoryQuantity: 3,
                },
                {
                  ...variant,
                  id: 'gid://shopify/ProductVariant/3',
                  product: { ...variant.product, status: 'DRAFT' },
                },
              ],
            },
          },
        }),
      )
    const page = await shopifyCatalog(shop, 'synthetic', null, http)
    expect(page.next).toBe('next-cursor')
    expect(page.products[0]).toMatchObject({
      title: 'Jacket',
      priceOre: 12525,
      barcode: '0012345678901',
      variantId: variant.id,
    })
    expect(page.products.map((p) => canImportPosProduct(p, 'SEK'))).toEqual([
      true,
      false,
      false,
    ])
    expect(canImportPosProduct(page.products[0], 'EUR')).toBe(false)
    expect(
      http.mock.calls.every(
        ([, init]) =>
          !JSON.parse(String(init?.body)).query.includes('mutation'),
      ),
    ).toBe(true)
  })
  it('returns null for a removed Shopify variant', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: {
            shop: {
              id: 'gid://shopify/Shop/1',
              name: 'Synthetic',
              myshopifyDomain: shop,
              currencyCode: 'SEK',
              primaryDomain: null,
            },
          },
        }),
      )
      .mockResolvedValueOnce(response({ data: { productVariant: null } }))
    expect(
      await shopifyCatalogItem(shop, 'synthetic', variant.id, http),
    ).toBeNull()
  })
  it('treats untracked stock as unknown and rechecks the actual shop currency', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: {
            shop: {
              id: 'gid://shopify/Shop/1',
              name: 'Synthetic',
              myshopifyDomain: shop,
              currencyCode: 'EUR',
              primaryDomain: null,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            productVariant: {
              ...variant,
              inventoryQuantity: 0,
              inventoryItem: { tracked: false },
            },
          },
        }),
      )
    const row = await shopifyCatalogItem(shop, 'synthetic', variant.id, http)
    expect(row).toMatchObject({ quantity: null, currency: 'EUR' })
    expect(canImportPosProduct(row!, 'SEK')).toBe(false)
  })
})
