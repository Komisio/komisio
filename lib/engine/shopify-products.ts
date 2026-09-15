import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  chooseLocation,
  createProductImage,
  findVariantBySku,
  listLocations,
  productPayload,
  setProduct,
  ShopifyUserError,
  stageImageUpload,
} from '../../extensions/shopify/products'
import { photoLimit } from '../media/reception-photo'
import { receptionDerivative } from '../media/reception-image'
import { shopifyAccessToken } from './shopify-connection'

// Products out (step 2): prepare records the payload, the request is made
// once, the outcome is recorded. A lost answer is recorded as unknown and
// the next run reconciles by sku before creating anything, so a product is
// never created twice for one item. Owner or admin, one item per call.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const shopifyCandidates = z
  .array(
    z.object({
      itemId: z.guid(),
      reference: z.string(),
      title: z.string().nullable(),
      priceOre: ore,
      exportedBefore: z.boolean(),
    }),
  )
  .max(20)
export const shopifyProductStatus = z
  .array(
    z.object({
      itemId: z.guid(),
      reference: z.string(),
      title: z.string(),
      price: z.string(),
      exportId: z.uuid(),
      createdAt: z.string(),
      status: z.enum(['pending', 'synced', 'failed', 'unknown']),
      errorCode: z.string().nullable(),
      productGid: z.string().nullable(),
      decidedAt: z.string().nullable(),
      imageStatus: z
        .enum(['synced', 'pending', 'failed'])
        .nullable()
        .optional(),
    }),
  )
  .max(50)

export async function readShopifyCandidates(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('shopify_product_candidates', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return shopifyCandidates.parse(r.data)
}

export async function readShopifyProductStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('shopify_product_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return shopifyProductStatus.parse(r.data)
}

export const exportShopifyItemInput = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  itemId: z.guid(),
})

export async function exportShopifyItem(
  client: SupabaseClient,
  input: unknown,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const c = exportShopifyItemInput.parse(input)
  const { accessToken, row } = await shopifyAccessToken(
    client,
    c.tenantId,
    source,
    http,
  )
  const prepared = await client.rpc('prepare_shopify_product', {
    p_tenant: c.tenantId,
    p_item: c.itemId,
  })
  if (prepared.error) throw new Error(prepared.error.message)
  const exportId = z.uuid().parse(prepared.data)
  const stored = await client
    .from('shopify_product_exports')
    .select('payload,product_gid')
    .eq('tenant_id', c.tenantId)
    .eq('id', exportId)
    .single()
  if (stored.error) throw new Error('SHOPIFY_READ_FAILED')
  const payload = productPayload.parse(stored.data.payload)
  const finish = async (
    status: 'synced' | 'failed' | 'unknown',
    error: string | null,
    ids?: {
      productGid: string
      variantGid: string
      inventoryItemGid: string | null
    },
  ) => {
    const r = await client.rpc('finish_shopify_product', {
      p_tenant: c.tenantId,
      p_export: exportId,
      p_status: status,
      p_error: error,
      p_product_gid: ids?.productGid ?? null,
      p_variant_gid: ids?.variantGid ?? null,
      p_inventory_item_gid: ids?.inventoryItemGid ?? null,
    })
    if (r.error) throw new Error('SHOPIFY_OUTCOME_FAILED')
  }
  // Preflight: a location to hold the unit, and whether the sku already exists
  // (an earlier unknown outcome, or a product created by hand in the shop).
  let existing: string | null = stored.data.product_gid ?? null
  let locationId: string
  try {
    const place = chooseLocation(
      await listLocations(row.shopDomain, accessToken, http),
    )
    if (!place) throw new Error('SHOPIFY_NO_LOCATION')
    locationId = place.id
    if (!existing) {
      const found = await findVariantBySku(
        row.shopDomain,
        accessToken,
        payload.sku,
        http,
      )
      if (found) existing = found.productGid
    }
  } catch (e) {
    const code = safeCode(e)
    await finish('failed', code)
    throw new Error(code)
  }
  try {
    const result = await setProduct(
      row.shopDomain,
      accessToken,
      payload,
      locationId,
      existing,
      http,
    )
    await finish('synced', null, result)
    const image = await attachImage(
      client,
      c.tenantId,
      c.itemId,
      row.shopDomain,
      accessToken,
      payload.title,
      http,
    )
    return {
      exportId,
      status: 'synced' as const,
      productGid: result.productGid,
      updated: existing !== null,
      image,
    }
  } catch (e) {
    if (e instanceof ShopifyUserError) {
      // Shopify answered and refused: nothing was created.
      await finish('failed', 'SHOPIFY_PRODUCT_REJECTED')
      throw e
    }
    const code = safeCode(e)
    // Anything else after the request left: the answer is unknown, so the
    // next run looks the sku up before it creates.
    await finish(
      'unknown',
      code === 'SHOPIFY_READ_FAILED' ? 'SHOPIFY_OUTCOME_UNKNOWN' : code,
    )
    throw new Error(
      code === 'SHOPIFY_READ_FAILED' ? 'SHOPIFY_OUTCOME_UNKNOWN' : code,
    )
  }
}

const imageClaim = z.object({
  id: z.uuid(),
  fresh: z.boolean(),
  reference: z
    .string()
    .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png)$/),
  productGid: z.string(),
  mediaGid: z.string().nullable(),
})

/**
 * The item's first reception photo as the product's image, once. No photo
 * (store-owned items, imports) means no image. A failure is recorded with its
 * code and never fails the export itself; the next export retries it.
 */
async function attachImage(
  client: SupabaseClient,
  tenantId: string,
  itemId: string,
  shop: string,
  accessToken: string,
  title: string,
  http?: typeof fetch,
): Promise<'synced' | 'none' | 'failed'> {
  const prepared = await client.rpc('prepare_shopify_image', {
    p_tenant: tenantId,
    p_id: randomUUID(),
    p_item: itemId,
  })
  if (prepared.error) return 'failed'
  if (prepared.data === null) return 'none'
  const claim = imageClaim.safeParse(prepared.data)
  if (!claim.success) return 'failed'
  if (claim.data.mediaGid) return 'synced'
  if (!claim.data.reference.startsWith(`${tenantId}/`)) return 'failed'
  const record = async (mediaGid: string | null, error: string | null) => {
    await client.rpc('record_shopify_image_result', {
      p_tenant: tenantId,
      p_intent: claim.data.id,
      p_media_gid: mediaGid,
      p_error: error,
    })
  }
  try {
    const downloaded = await client.storage
      .from('reception-photos')
      .download(claim.data.reference)
    if (
      downloaded.error ||
      !downloaded.data ||
      downloaded.data.size > photoLimit
    )
      throw new Error('SHOPIFY_IMAGE_INVALID')
    let bytes: Buffer
    try {
      bytes = await receptionDerivative(
        new Uint8Array(await downloaded.data.arrayBuffer()),
      )
    } catch {
      throw new Error('SHOPIFY_IMAGE_INVALID')
    }
    const resourceUrl = await stageImageUpload(
      shop,
      accessToken,
      `${itemId}.jpg`,
      bytes,
      http,
    )
    const mediaGid = await createProductImage(
      shop,
      accessToken,
      claim.data.productGid,
      resourceUrl,
      title,
      http,
    )
    await record(mediaGid, null)
    return 'synced'
  } catch (e) {
    await record(null, safeCode(e))
    return 'failed'
  }
}

function safeCode(e: unknown) {
  const message = e instanceof Error ? e.message : ''
  return /^SHOPIFY_[A-Z_]{1,80}$/.test(message)
    ? message
    : 'SHOPIFY_EXPORT_FAILED'
}
