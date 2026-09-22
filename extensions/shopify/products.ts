import { z } from 'zod'
import { graphql } from './auth'
import { shopifySettings } from './settings'

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
  syncSettings: shopifySettings.nullable().optional(),
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

/** One product with one variant; an update names the product by id and updates price without replenishing inventory. */
export function productSetInput(
  payload: ProductPayload,
  locationId: string,
  existingProductGid: string | null,
  existingVariantGid: string | null = null,
) {
  if (existingProductGid && !existingVariantGid)
    throw new Error('SHOPIFY_SKU_AMBIGUOUS')
  const input: Record<string, unknown> = {
    title: payload.title,
    status: 'ACTIVE',
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [
      {
        ...(existingVariantGid ? { id: existingVariantGid } : {}),
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        sku: payload.sku,
        barcode: payload.reference,
        price: payload.price,
        inventoryPolicy: 'DENY',
        inventoryItem: { tracked: true },
        ...(existingProductGid
          ? {}
          : {
              inventoryQuantities: [
                { locationId, name: 'available', quantity: payload.quantity },
              ],
            }),
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
  existingVariantGid: string | null = null,
): Promise<ProductResult> {
  const variables = productSetInput(
    payload,
    locationId,
    existingProductGid,
    existingVariantGid,
  )
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
              variants(first: 2) {
                nodes {
                  id
                }
              }
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
            product: z.object({
              id: z.string(),
              variants: z.object({
                nodes: z.array(z.object({ id: z.string() })).max(2),
              }),
            }),
            inventoryItem: z.object({ id: z.string() }).nullable(),
          }),
        ),
      }),
    })
    .parse(data)
    .productVariants.nodes.filter((n) => n.sku === sku)
  if (nodes.length > 1) throw new Error('SHOPIFY_SKU_AMBIGUOUS')
  const node = nodes[0]
  if (
    node &&
    (node.product.variants.nodes.length !== 1 ||
      node.product.variants.nodes[0].id !== node.id)
  )
    throw new Error('SHOPIFY_SKU_AMBIGUOUS')
  return node
    ? {
        productGid: node.product.id,
        variantGid: node.id,
        inventoryItemGid: node.inventoryItem?.id ?? null,
      }
    : null
}

const STAGED_UPLOAD = `mutation Stage($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`
const CREATE_MEDIA = `mutation Media($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { id status }
    mediaUserErrors { field message code }
  }
}`

/**
 * Upload one JPEG through Shopify's staged upload: ask for a target, post the
 * bytes with the target's parameters, hand back the resource URL that
 * productCreateMedia accepts as originalSource.
 */
export async function stageImageUpload(
  shop: string,
  accessToken: string,
  filename: string,
  bytes: Uint8Array,
  http: typeof fetch = globalThis.fetch,
): Promise<string> {
  const data = await graphql(
    shop,
    accessToken,
    STAGED_UPLOAD,
    {
      input: [
        {
          filename,
          mimeType: 'image/jpeg',
          resource: 'IMAGE',
          httpMethod: 'POST',
        },
      ],
    },
    http,
  )
  const parsed = z
    .object({
      stagedUploadsCreate: z.object({
        stagedTargets: z
          .array(
            z.object({
              url: z.string().url(),
              resourceUrl: z.string().url(),
              parameters: z
                .array(z.object({ name: z.string(), value: z.string() }))
                .max(30),
            }),
          )
          .max(1),
        userErrors: z.array(z.object({ message: z.string() })),
      }),
    })
    .parse(data).stagedUploadsCreate
  const target = parsed.stagedTargets[0]
  if (parsed.userErrors.length || !target)
    throw new Error('SHOPIFY_UPLOAD_REJECTED')
  if (!target.url.startsWith('https://'))
    throw new Error('SHOPIFY_UPLOAD_REJECTED')
  const form = new FormData()
  for (const { name, value } of target.parameters) form.append(name, value)
  form.append(
    'file',
    new Blob([bytes as BlobPart], { type: 'image/jpeg' }),
    filename,
  )
  let response: Response
  try {
    response = await http(target.url, {
      method: 'POST',
      body: form,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw new Error('SHOPIFY_CONNECTION_FAILED')
  }
  if (!response.ok) throw new Error('SHOPIFY_UPLOAD_FAILED')
  return target.resourceUrl
}

/** Attach one staged image to a product; returns the media id. */
export async function createProductImage(
  shop: string,
  accessToken: string,
  productGid: string,
  resourceUrl: string,
  alt: string,
  http?: typeof fetch,
): Promise<string> {
  const data = await graphql(
    shop,
    accessToken,
    CREATE_MEDIA,
    {
      productId: productGid,
      media: [
        {
          originalSource: resourceUrl,
          mediaContentType: 'IMAGE',
          alt: alt.slice(0, 255),
        },
      ],
    },
    http,
  )
  const parsed = z
    .object({
      productCreateMedia: z.object({
        media: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              status: z.string().nullable().optional(),
            }),
          )
          .nullable(),
        mediaUserErrors: z.array(z.object({ message: z.string() })),
      }),
    })
    .parse(data).productCreateMedia
  const media = parsed.media?.[0]
  if (parsed.mediaUserErrors.length || !media)
    throw new Error('SHOPIFY_IMAGE_REJECTED')
  return media.id
}
