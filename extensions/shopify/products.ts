import { z } from 'zod'
import { graphql } from './auth'

// Admin API 2026-07 calls for products out: the shop's locations, one
// productSet per item (create, or update by product id) and a variant
// lookup by sku for reconciliation after a lost answer. Every call is
// bounded and throws fixed codes.

export const location = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200),
  isActive: z.boolean(),
  fulfillsOnlineOrders: z.boolean(),
})
export type Location = z.infer<typeof location>

export async function listLocations(
  shop: string,
  accessToken: string,
  http?: typeof fetch,
): Promise<Location[]> {
  const data = await graphql(
    shop,
    accessToken,
    '{ locations(first: 50) { edges { node { id name isActive fulfillsOnlineOrders } } } }',
    {},
    http,
  )
  return z
    .object({
      locations: z.object({
        edges: z.array(z.object({ node: location })).max(50),
      }),
    })
    .parse(data)
    .locations.edges.map((e) => e.node)
}

/** The first active location that fulfils online orders, else the first active one. */
export function chooseLocation(locations: Location[]) {
  const active = locations.filter((l) => l.isActive)
  return active.find((l) => l.fulfillsOnlineOrders) ?? active[0] ?? null
}

export const productPayload = z.object({
  title: z.string().min(1).max(255),
  category: z.string().nullable(),
  sku: z.string().regex(/^K-[0-9a-f-]{36}$/),
  reference: z.string(),
  price: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.string().length(3),
  quantity: z.number().int().min(0).max(1),
})
export type ProductPayload = z.infer<typeof productPayload>

export const productResult = z.object({
  productGid: z.string().min(1).max(200),
  variantGid: z.string().min(1).max(200),
  inventoryItemGid: z.string().max(200).nullable(),
})
export type ProductResult = z.infer<typeof productResult>

const PRODUCT_SET = `mutation SetProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(synchronous: true, input: $input, identifier: $identifier) {
    product { id variants(first: 1) { nodes { id sku inventoryItem { id } } } }
    userErrors { field message code }
  }
}`

/** One product with one variant; an update names the product by id and keeps sku, price and quantity in step. */
export function productSetInput(
  payload: ProductPayload,
  locationId: string,
  existingProductGid: string | null,
) {
  const input: Record<string, unknown> = {
    title: payload.title,
    status: 'ACTIVE',
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [
      {
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        sku: payload.sku,
        price: payload.price,
        inventoryPolicy: 'DENY',
        inventoryItem: { tracked: true },
        inventoryQuantities: [
          { locationId, name: 'available', quantity: payload.quantity },
        ],
      },
    ],
  }
  if (payload.category) input.productType = payload.category
  return {
    input,
    identifier: existingProductGid ? { id: existingProductGid } : null,
  }
}

export class ShopifyUserError extends Error {
  constructor(public readonly detail: string) {
    super('SHOPIFY_PRODUCT_REJECTED')
  }
}

export async function setProduct(
  shop: string,
  accessToken: string,
  payload: ProductPayload,
  locationId: string,
  existingProductGid: string | null,
  http?: typeof fetch,
): Promise<ProductResult> {
  const variables = productSetInput(payload, locationId, existingProductGid)
  const data = await graphql(shop, accessToken, PRODUCT_SET, variables, http)
  const parsed = z
    .object({
      productSet: z.object({
        product: z
          .object({
            id: z.string(),
            variants: z.object({
              nodes: z.array(
                z.object({
                  id: z.string(),
                  sku: z.string().nullable(),
                  inventoryItem: z.object({ id: z.string() }).nullable(),
                }),
              ),
            }),
          })
          .nullable(),
        userErrors: z.array(
          z.object({
            field: z.array(z.string()).nullable(),
            message: z.string(),
            code: z.string().nullable().optional(),
          }),
        ),
      }),
    })
    .parse(data).productSet
  if (parsed.userErrors.length)
    throw new ShopifyUserError(
      parsed.userErrors
        .map((e) => e.message)
        .join('; ')
        .slice(0, 500),
    )
  const product = parsed.product
  const variant = product?.variants.nodes[0]
  if (!product || !variant || variant.sku !== payload.sku)
    throw new Error('SHOPIFY_READ_FAILED')
  return {
    productGid: product.id,
    variantGid: variant.id,
    inventoryItemGid: variant.inventoryItem?.id ?? null,
  }
}

/** After a lost answer: does the shop already hold a variant with this sku? */
export async function findVariantBySku(
  shop: string,
  accessToken: string,
  sku: string,
  http?: typeof fetch,
): Promise<ProductResult | null> {
  const data = await graphql(
    shop,
    accessToken,
    `
      query FindBySku($q: String!) {
        productVariants(first: 2, query: $q) {
          nodes {
            id
            sku
            product {
              id
            }
            inventoryItem {
              id
            }
          }
        }
      }
    `,
    { q: `sku:${sku}` },
    http,
  )
  const nodes = z
    .object({
      productVariants: z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            sku: z.string().nullable(),
            product: z.object({ id: z.string() }),
            inventoryItem: z.object({ id: z.string() }).nullable(),
          }),
        ),
      }),
    })
    .parse(data)
    .productVariants.nodes.filter((n) => n.sku === sku)
  if (nodes.length > 1) throw new Error('SHOPIFY_SKU_AMBIGUOUS')
  const node = nodes[0]
  return node
    ? {
        productGid: node.product.id,
        variantGid: node.id,
        inventoryItemGid: node.inventoryItem?.id ?? null,
      }
    : null
}
