import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { SupabaseClient } from '@supabase/supabase-js'
import { paypalEnvironment } from './paypal-credentials'
import { shopifyAccessToken } from './shopify-connection'
import {
  paypalCatalog,
  shopifyCatalog,
  paypalCatalogItem,
  shopifyCatalogItem,
} from '../../extensions/pos-catalog'
import {
  posChoice,
  posCommand,
  posPage,
  posProduct,
  posProvider,
  posResult,
  type PosProvider,
} from '../pos-import'
import { open, seal } from '../platform/credentials'

const purpose = 'pos-import-review-v1'
const review = z.object({
  tenantId: z.uuid(),
  actorId: z.uuid(),
  provider: posProvider,
  account: z.string(),
  product: posProduct,
  expires: z.number().int(),
})
export async function runPosImport(
  client: SupabaseClient,
  actorId: string,
  input: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const c = posCommand.parse(input)
  const role = await client.rpc('tenant_role', { p_tenant: c.tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  async function catalog(provider: PosProvider, cursor: string | null) {
    if (provider === 'paypal') {
      const credentials = await paypalEnvironment(client, c.tenantId, env)
      if (!credentials.ZETTLE_MERCHANT_ID || !credentials.ZETTLE_ACCESS_TOKEN)
        throw new Error('POS_NOT_CONNECTED')
      return {
        account: credentials.ZETTLE_MERCHANT_ID,
        ...(await paypalCatalog(
          credentials.ZETTLE_MERCHANT_ID,
          credentials.ZETTLE_ACCESS_TOKEN,
          cursor,
        )),
      }
    }
    const credentials = await shopifyAccessToken(client, c.tenantId, env)
    return {
      account: credentials.row.shopDomain,
      ...(await shopifyCatalog(
        credentials.row.shopDomain,
        credentials.accessToken,
        cursor,
      )),
    }
  }
  if (c.action === 'search') {
    const r = await client.rpc('pos_import_search', {
      p_tenant: c.tenantId,
      p_query: c.query,
    })
    if (r.error) throw new Error(r.error.message)
    return { items: z.array(posChoice).max(20).parse(r.data) }
  }
  if (c.action === 'list') {
    const page = await catalog(c.provider, c.cursor)
    const r = await client.rpc('pos_import_preview', {
      p_tenant: c.tenantId,
      p_provider: c.provider,
      p_account: page.account,
      p_products: page.products,
    })
    if (r.error) throw new Error(r.error.message)
    const rows = z
      .array(
        z.object({
          linked: posChoice.nullable(),
          suggestions: z.array(posChoice).max(10),
        }),
      )
      .length(page.products.length)
      .parse(r.data)
    return posPage.parse({
      account: page.account,
      next: page.next,
      rows: page.products.map((product, i) => ({
        product,
        ...rows[i],
        token: JSON.stringify(
          seal(
            purpose,
            {
              tenantId: c.tenantId,
              actorId,
              provider: c.provider,
              account: page.account,
              product,
              expires: Date.now() + 86400000,
            },
            env,
          ),
        ),
      })),
    })
  }
  let snapshot: z.infer<typeof review>
  try {
    snapshot = review.parse(open(purpose, JSON.parse(c.token), env))
  } catch {
    throw new Error('POS_REVIEW_EXPIRED')
  }
  if (snapshot.tenantId !== c.tenantId || snapshot.actorId !== actorId)
    throw new Error('POS_REVIEW_EXPIRED')
  if (c.action === 'commit') {
    const replay = await client.rpc('pos_import_result', {
      p_tenant: c.tenantId,
      p_request: c.requestId,
    })
    if (replay.error) throw new Error(replay.error.message)
    if (replay.data) {
      const expected = {
        provider: snapshot.provider,
        account: snapshot.account,
        product: snapshot.product,
        mode: c.mode,
        item: c.itemId,
        seller: c.sellerId,
        context: c.context,
        received: c.received,
      }
      if (!isDeepStrictEqual(replay.data.input, expected))
        throw new Error('REQUEST_CONFLICT')
      const result = posResult.parse(replay.data.result)
      if (result.requestId !== c.requestId) throw new Error('REQUEST_FAILED')
      return result
    }
  }
  if (snapshot.expires < Date.now()) throw new Error('POS_REVIEW_EXPIRED')
  if (c.action === 'prepare') {
    const r = await client.rpc('inventory_import_context', {
      p_tenant: c.tenantId,
      p_sellers: [c.sellerId],
    })
    if (r.error) throw new Error(r.error.message)
    return {
      context: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .parse(r.data),
    }
  }
  let fresh
  if (snapshot.provider === 'paypal') {
    const credentials = await paypalEnvironment(client, c.tenantId, env)
    if (
      credentials.ZETTLE_MERCHANT_ID !== snapshot.account ||
      !credentials.ZETTLE_ACCESS_TOKEN
    )
      throw new Error('POS_CONNECTION_CHANGED')
    fresh = await paypalCatalogItem(
      snapshot.account,
      credentials.ZETTLE_ACCESS_TOKEN,
      snapshot.product.productId,
      snapshot.product.variantId,
    )
  } else {
    const credentials = await shopifyAccessToken(client, c.tenantId, env)
    if (credentials.row.shopDomain !== snapshot.account)
      throw new Error('POS_CONNECTION_CHANGED')
    fresh = await shopifyCatalogItem(
      snapshot.account,
      credentials.accessToken,
      snapshot.product.variantId,
    )
  }
  if (!isDeepStrictEqual(fresh, snapshot.product))
    throw new Error('POS_REVIEW_EXPIRED')
  const r = await client.rpc('commit_pos_import', {
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_provider: snapshot.provider,
    p_account: snapshot.account,
    p_product: snapshot.product,
    p_mode: c.mode,
    p_item: c.itemId,
    p_seller: c.sellerId,
    p_context: c.context,
    p_received: c.received,
  })
  if (r.error) throw new Error(r.error.message)
  const result = posResult.parse(r.data)
  if (result.requestId !== c.requestId) throw new Error('REQUEST_FAILED')
  return result
}
