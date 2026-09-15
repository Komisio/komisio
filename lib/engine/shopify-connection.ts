import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authorizeUrl,
  exchangeCode,
  readShop,
  shopDomain,
  shopifyEnvironment,
  shopifyIssue,
  verifyCallbackHmac,
  verifyShop,
  type ShopifyEnvironment,
  type TokenSet,
} from '../../extensions/shopify/auth'
import {
  credentialKeyConfigured,
  open,
  seal,
  sealedBox,
  signState,
  verifyState,
} from '../platform/credentials'

// The store's Shopify connection: start the OAuth round trip for a named
// shop, complete it by verifying the shop and sealing the token, check it
// read-only, disconnect. All database writes go through engine functions;
// the token exists in clear text only inside a request on the server.
// Token renewal for expiring tokens is a later slice; an expired token reads
// as "reconnect needed".
const PURPOSE = 'shopify-connection'
const STATE_TTL = 600

export const connectionStatus = z.object({
  connected: z.boolean(),
  shopDomain: z.string().nullable(),
  shopName: z.string().nullable(),
  currency: z.string().nullable(),
  scope: z.string().nullable(),
  expiresAt: z.string().nullable(),
  connectedAt: z.string().nullable(),
  refreshedAt: z.string().nullable(),
  events: z
    .array(
      z.object({
        kind: z.enum([
          'connected',
          'refreshed',
          'checked',
          'refused',
          'disconnected',
        ]),
        detail: z.record(z.string(), z.unknown()),
        occurredAt: z.string(),
      }),
    )
    .max(20),
})
export type ShopifyConnectionStatus = z.infer<typeof connectionStatus>

export async function readShopifyStatus(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('shopify_connection_status', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202')
    return connectionStatus.parse({
      connected: false,
      shopDomain: null,
      shopName: null,
      currency: null,
      scope: null,
      expiresAt: null,
      connectedAt: null,
      refreshedAt: null,
      events: [],
    })
  if (r.error) throw new Error('FORBIDDEN')
  return connectionStatus.parse(r.data)
}

async function requireOwner(client: SupabaseClient, tenantId: string) {
  z.uuid().parse(tenantId)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
}

function ready(tenantId: string, source: ShopifyEnvironment) {
  const env = shopifyEnvironment(source)
  if (shopifyIssue(tenantId, env)) throw new Error('SHOPIFY_NOT_CONNECTED')
  if (!credentialKeyConfigured(source as Record<string, string | undefined>))
    throw new Error('CREDENTIAL_KEY_MISSING')
  return env
}

/** The authorisation URL for one named shop and the signed state the callback must return. */
export async function startShopifyConnection(
  client: SupabaseClient,
  tenantId: string,
  shopInput: string,
  redirectUri: string,
  source: Record<string, string | undefined>,
) {
  await requireOwner(client, tenantId)
  const env = ready(tenantId, source)
  const shop = shopDomain.parse(shopInput)
  const state = signState(PURPOSE, { tenantId, shop }, STATE_TTL, source)
  return { url: authorizeUrl(env, shop, redirectUri, state), state }
}

const stored = z.object({
  shopDomain: z.string(),
  shopName: z.string(),
  currency: z.string(),
  cipher: sealedBox,
  scope: z.string(),
  expiresAt: z.string().nullable(),
  revision: z.string().optional(),
})

async function persist(
  client: SupabaseClient,
  tenantId: string,
  shop: { myshopifyDomain: string; name: string; currencyCode: string },
  tokens: TokenSet,
  source: Record<string, string | undefined>,
) {
  const cipher = seal(
    PURPOSE,
    {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
    },
    source,
  )
  const r = await client.rpc('store_shopify_connection', {
    p_tenant: tenantId,
    p_shop_domain: shop.myshopifyDomain,
    p_shop_name: shop.name,
    p_currency: shop.currencyCode,
    p_cipher: cipher,
    p_scope: tokens.scope ?? '',
    p_expires_at: tokens.expires_in
      ? new Date(
          Date.now() + Math.max(60, tokens.expires_in - 60) * 1000,
        ).toISOString()
      : null,
  })
  if (r.error) throw new Error(r.error.message)
}

/**
 * The callback: verify Shopify's hmac and our state, exchange the code for
 * the shop named in the state, read the shop, refuse any other shop
 * (recording the refusal without the token), then seal and store.
 */
export async function completeShopifyConnection(
  client: SupabaseClient,
  input: { params: URLSearchParams; cookieState: string | null },
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const stateParam = input.params.get('state')
  const state = verifyState(PURPOSE, stateParam, source)
  if (!state || !input.cookieState || input.cookieState !== stateParam)
    throw new Error('SHOPIFY_STATE_INVALID')
  const tenantId = z.uuid().parse(state.tenantId)
  await requireOwner(client, tenantId)
  const env = ready(tenantId, source)
  if (!verifyCallbackHmac(env, input.params))
    throw new Error('SHOPIFY_STATE_INVALID')
  const shop = shopDomain.parse(state.shop)
  const answered = shopDomain.safeParse(input.params.get('shop') ?? '')
  if (!answered.success || answered.data !== shop)
    throw new Error('SHOPIFY_WRONG_SHOP')
  const tokens = await exchangeCode(
    env,
    shop,
    input.params.get('code') ?? '',
    http,
  )
  const info = await readShop(shop, tokens.access_token, http)
  try {
    verifyShop(shop, info)
  } catch {
    await client.rpc('record_shopify_check', {
      p_tenant: tenantId,
      p_kind: 'refused',
      p_detail: {
        shop_domain: info.myshopifyDomain,
        reason: 'SHOPIFY_WRONG_SHOP',
      },
    })
    throw new Error('SHOPIFY_WRONG_SHOP')
  }
  await persist(client, tenantId, info, tokens, source)
  return { tenantId, shopDomain: info.myshopifyDomain, shopName: info.name }
}

/** A valid access token for the store; an expired one asks for a reconnect. */
export async function shopifyAccessToken(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
) {
  await requireOwner(client, tenantId)
  ready(tenantId, source)
  const r = await client.rpc('read_shopify_connection', { p_tenant: tenantId })
  if (r.error) throw new Error('FORBIDDEN')
  if (!r.data) throw new Error('SHOPIFY_NOT_CONNECTED')
  const row = stored.parse(r.data)
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())
    throw new Error('SHOPIFY_AUTH_REQUIRED')
  const secrets = z
    .object({ accessToken: z.string(), refreshToken: z.string().nullable() })
    .parse(open(PURPOSE, row.cipher, source))
  return { accessToken: secrets.accessToken, row }
}

/** Read-only: the shop Shopify answers for the stored token, checked against the stored domain. */
export async function checkShopifyConnection(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const { accessToken, row } = await shopifyAccessToken(
    client,
    tenantId,
    source,
  )
  const info = await readShop(row.shopDomain, accessToken, http)
  if (info.myshopifyDomain !== row.shopDomain) {
    await client.rpc('record_shopify_check', {
      p_tenant: tenantId,
      p_kind: 'refused',
      p_detail: {
        shop_domain: info.myshopifyDomain,
        reason: 'SHOPIFY_WRONG_SHOP',
      },
    })
    throw new Error('SHOPIFY_WRONG_SHOP')
  }
  await client.rpc('record_shopify_check', {
    p_tenant: tenantId,
    p_kind: 'checked',
    p_detail: {
      shop_domain: info.myshopifyDomain,
      shop_name: info.name,
      currency: info.currencyCode,
    },
  })
  return {
    shopDomain: info.myshopifyDomain,
    shopName: info.name,
    currency: info.currencyCode,
    checkedAt: new Date().toISOString(),
  }
}

export async function disconnectShopify(
  client: SupabaseClient,
  tenantId: string,
) {
  await requireOwner(client, tenantId)
  const r = await client.rpc('disconnect_shopify', { p_tenant: tenantId })
  if (r.error) throw new Error('FORBIDDEN')
  return { disconnected: r.data === true }
}

export const shopifyErrorCodes = [
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'TENANT_CHANGED',
  'INVALID_INPUT',
  'SHOPIFY_NOT_CONNECTED',
  'SHOPIFY_AUTH_REQUIRED',
  'SHOPIFY_CONNECTION_FAILED',
  'SHOPIFY_RATE_LIMITED',
  'SHOPIFY_READ_FAILED',
  'SHOPIFY_WRONG_SHOP',
  'SHOPIFY_STATE_INVALID',
  'CREDENTIAL_KEY_MISSING',
  'CREDENTIAL_UNREADABLE',
] as const
export function shopifyErrorCode(message: string) {
  return (
    shopifyErrorCodes.find((code) => message.includes(code)) ?? 'REQUEST_FAILED'
  )
}

/** Whether a stored expiring token has passed its expiry; legacy tokens never expire. */
export function shopifyTokenExpired(status: { expiresAt: string | null }) {
  return !!status.expiresAt && Date.parse(status.expiresAt) <= Date.now()
}
