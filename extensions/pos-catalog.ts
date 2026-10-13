import { z } from 'zod'
import { boundedJson } from '../lib/http/bounded-json'
import { posProduct, type PosProduct } from '../lib/pos-import'
import { graphql, readShop } from './shopify/auth'
import { toOre } from './shopify/orders'

export type CatalogPage = { products: PosProduct[]; next: string | null }
const optionalText = z
  .string()
  .max(200)
  .nullish()
  .transform((v) => v || null)
const zettleProduct = z.object({
  uuid: z.uuid(),
  name: z.string().min(1).max(1000),
  variants: z
    .array(
      z.object({
        uuid: z.uuid(),
        name: z.string().max(1000).nullish(),
        sku: optionalText,
        barcode: optionalText,
        price: z
          .object({
            amount: z.number().int().min(0).max(99999999),
            currencyId: z.string().length(3),
          })
          .nullish(),
      }),
    )
    .min(1)
    .max(500),
})
function paypalRows(input: z.infer<typeof zettleProduct>) {
  return input.variants.map((v) =>
    posProduct.parse({
      productId: input.uuid,
      variantId: v.uuid,
      title: [input.name, v.name].filter(Boolean).join(' · ').slice(0, 1000),
      sku: v.sku,
      barcode: v.barcode,
      priceOre: v.price?.amount ?? null,
      currency: v.price?.currencyId ?? null,
      quantity: null,
      active: true,
    }),
  )
}
export async function paypalCatalogItem(
  merchant: string,
  token: string,
  productId: string,
  variantId: string,
  http = fetch,
) {
  const r = await http(
    `https://products.izettle.com/organizations/${z.uuid().parse(merchant)}/products/${z.uuid().parse(productId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!r.ok) throw new Error('POS_READ_FAILED')
  return (
    paypalRows(zettleProduct.parse(await boundedJson(r, 1000000))).find(
      (v) => v.variantId === variantId,
    ) ?? null
  )
}

/** Official library endpoint, 50 products per page; never follow a provider-supplied URL. */
export async function paypalCatalog(
  merchant: string,
  token: string,
  cursor: string | null,
  http = fetch,
): Promise<CatalogPage> {
  z.uuid().parse(merchant)
  const offset =
    cursor === null
      ? 0
      : Number(
          z
            .string()
            .regex(/^\d{1,7}$/)
            .parse(cursor),
        )
  async function get(url: string) {
    const r = await http(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok)
      throw new Error(r.status === 429 ? 'POS_RATE_LIMITED' : 'POS_READ_FAILED')
    return r
  }
  const identity = z
    .object({ organizationUuid: z.uuid() })
    .parse(
      await boundedJson(await get('https://oauth.zettle.com/users/self'), 8192),
    )
  if (identity.organizationUuid !== merchant)
    throw new Error('POS_CONNECTION_CHANGED')
  const response = await get(
    `https://products.izettle.com/organizations/self/library?limit=50&offset=${offset}`,
  )
  const body = z
    .object({ products: z.array(zettleProduct).max(50) })
    .parse(await boundedJson(response, 2000000))
  const products = body.products.flatMap(paypalRows)
  if (products.length > 500) throw new Error('POS_PAGE_TOO_LARGE')
  const link = response.headers.get('link') ?? ''
  const nextOffset = link
    .split(',')
    .find((v) => /rel="?next"?/.test(v))
    ?.match(/[?&]offset=(\d{1,7})(?:[&>;\s]|$)/)?.[1]
  if (
    /rel="?next"?/.test(link) &&
    (!nextOffset || Number(nextOffset) <= offset)
  )
    throw new Error('POS_READ_FAILED')
  const next = nextOffset ?? null
  return { products, next }
}

const QUERY = `query ImportCatalog($after: String) {
  productVariants(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title sku barcode price inventoryQuantity inventoryItem { tracked } product { id title status } }
  }
}`
const shopifyVariant = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  title: z.string(),
  sku: optionalText,
  barcode: optionalText,
  price: z.string(),
  inventoryQuantity: z.number().int().nullable(),
  inventoryItem: z.object({ tracked: z.boolean() }),
  product: z.object({
    id: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
    title: z.string(),
    status: z.string(),
  }),
})
function shopifyRow(v: z.infer<typeof shopifyVariant>, currency: string) {
  return posProduct.parse({
    productId: v.product.id,
    variantId: v.id,
    title: [v.product.title, v.title === 'Default Title' ? '' : v.title]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 1000),
    sku: v.sku,
    barcode: v.barcode,
    priceOre: toOre(v.price),
    currency,
    quantity: v.inventoryItem.tracked ? v.inventoryQuantity : null,
    active: v.product.status === 'ACTIVE',
  })
}
export async function shopifyCatalogItem(
  shop: string,
  token: string,
  variantId: string,
  http = fetch,
) {
  const info = await readShop(shop, token, http)
  if (info.myshopifyDomain !== shop) throw new Error('POS_CONNECTION_CHANGED')
  const data = z.object({ productVariant: shopifyVariant.nullable() }).parse(
    await graphql(
      shop,
      token,
      `
        query ImportVariant($id: ID!) {
          productVariant(id: $id) {
            id
            title
            sku
            barcode
            price
            inventoryQuantity
            inventoryItem {
              tracked
            }
            product {
              id
              title
              status
            }
          }
        }
      `,
      { id: variantId },
      http,
    ),
  )
  return data.productVariant
    ? shopifyRow(data.productVariant, info.currencyCode)
    : null
}
export async function shopifyCatalog(
  shop: string,
  token: string,
  cursor: string | null,
  http = fetch,
): Promise<CatalogPage> {
  const info = await readShop(shop, token, http)
  if (info.myshopifyDomain !== shop) throw new Error('POS_CONNECTION_CHANGED')
  const data = z
    .object({
      productVariants: z.object({
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().max(2000).nullable(),
        }),
        nodes: z.array(shopifyVariant).max(50),
      }),
    })
    .parse(
      await graphql(shop, token, QUERY, { after: cursor }, http),
    ).productVariants
  if (data.pageInfo.hasNextPage && !data.pageInfo.endCursor)
    throw new Error('POS_READ_FAILED')
  return {
    products: data.nodes.map((v) => shopifyRow(v, info.currencyCode)),
    next: data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null,
  }
}
