import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'

// Shopify authorization code grant and the one read this slice makes: the
// shop. The app (client id and secret) is registered by Komisio in Shopify's
// Dev Dashboard; which shop a token is for is decided by the merchant who
// installs it, so the shop domain is verified and pinned before anything is
// stored. Nothing here writes to Shopify. Official references, checked
// 2026-09-15: authorization code grant, GraphQL Admin API 2026-07.
export const SHOPIFY_API_VERSION = '2026-07'
export const SHOPIFY_SCOPES = [
  'read_orders',
  'write_products',
  'write_inventory',
  'read_locations',
  'read_publications',
  'write_publications',
] as const
export type ShopifyEnvironment = {
  SHOPIFY_CLIENT_ID?: string
  SHOPIFY_CLIENT_SECRET?: string
  SHOPIFY_PILOT_TENANT_ID?: string
}
export type ShopifyIssue =
  | 'connectionUnavailable'
  | 'connectionTenantMissing'
  | 'connectionClientMissing'
  | 'connectionSecretMissing'

export function shopifyEnvironment(
  env: Record<string, string | undefined>,
): ShopifyEnvironment {
  return {
    SHOPIFY_CLIENT_ID: env.SHOPIFY_CLIENT_ID?.trim(),
    SHOPIFY_CLIENT_SECRET: env.SHOPIFY_CLIENT_SECRET?.trim(),
    SHOPIFY_PILOT_TENANT_ID: env.SHOPIFY_PILOT_TENANT_ID?.trim(),
  }
}

/** Host OAuth application readiness; membership and account binding are enforced by the engine. */
export function shopifyIssue(
  tenantId: string,
  source: ShopifyEnvironment,
): ShopifyIssue | null {
  const env = shopifyEnvironment(source)
  if (!z.uuid().safeParse(tenantId).success) return 'connectionUnavailable'
  if (!env.SHOPIFY_CLIENT_ID || /[\s]/.test(env.SHOPIFY_CLIENT_ID))
    return 'connectionClientMissing'
  if (!env.SHOPIFY_CLIENT_SECRET) return 'connectionSecretMissing'
  return null
}

/** Shopify's own rule for the shop host; anything else is refused before any request. */
export const shopDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/)
  .max(120)

export function authorizeUrl(
  env: ShopifyEnvironment,
  shop: string,
  redirectUri: string,
  state: string,
) {
  const host = shopDomain.parse(shop)
  const url = new URL(`https://${host}/admin/oauth/authorize`)
  url.searchParams.set('client_id', env.SHOPIFY_CLIENT_ID ?? '')
  url.searchParams.set('scope', SHOPIFY_SCOPES.join(','))
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * The callback's own signature: every query parameter except hmac, sorted,
 * joined as key=value with &, HMAC-SHA256 with the client secret, compared
 * in constant time.
 */
export function verifyCallbackHmac(
  env: ShopifyEnvironment,
  params: URLSearchParams,
) {
  const hmac = params.get('hmac') ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hmac) || !env.SHOPIFY_CLIENT_SECRET) return false
  const message = [...params.entries()]
    .filter(([key]) => key !== 'hmac')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const expected = createHmac('sha256', env.SHOPIFY_CLIENT_SECRET)
    .update(message)
    .digest('hex')
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(hmac.toLowerCase(), 'hex'),
  )
}

export const tokenSet = z.object({
  access_token: z.string().min(1).max(32768),
  scope: z.string().max(4096).optional().default(''),
  // Expiring tokens carry these; legacy non-expiring tokens omit them.
  expires_in: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform(Number)
    .pipe(z.number().int().min(1).max(31_536_000))
    .optional(),
  refresh_token: z.string().min(1).max(32768).optional(),
  refresh_token_expires_in: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform(Number)
    .optional(),
})
export type TokenSet = z.infer<typeof tokenSet>

export async function exchangeCode(
  env: ShopifyEnvironment,
  shop: string,
  code: string,
  http: typeof fetch = globalThis.fetch,
) {
  const host = shopDomain.parse(shop)
  if (!code || code.length > 4096 || /[\s]/.test(code))
    throw new Error('SHOPIFY_AUTH_REQUIRED')
  let response: Response
  try {
    response = await http(`https://${host}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: env.SHOPIFY_CLIENT_ID ?? '',
        client_secret: env.SHOPIFY_CLIENT_SECRET ?? '',
        code,
      }).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('SHOPIFY_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('SHOPIFY_RATE_LIMITED')
  if (!response.ok) throw new Error('SHOPIFY_AUTH_REQUIRED')
  const tokens = tokenSet.parse(await boundedJson(response, 65536))
  if (/[\r\n]/.test(tokens.access_token))
    throw new Error('SHOPIFY_AUTH_REQUIRED')
  return tokens
}

export const shopInformation = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  myshopifyDomain: shopDomain,
  currencyCode: z.string().min(3).max(3),
  primaryDomain: z.object({ host: z.string().max(253) }).nullable(),
})
export type ShopInformation = z.infer<typeof shopInformation>

/** One GraphQL query against the Admin API; the token exists only inside this call. */
/** Expiring offline tokens: the same endpoint with grant_type refresh_token; the old refresh token is retired once the new one is used. */
export async function refreshTokens(
  env: ShopifyEnvironment,
  shop: string,
  refreshToken: string,
  http: typeof fetch = globalThis.fetch,
) {
  const host = shopDomain.parse(shop)
  if (!refreshToken || /[\s]/.test(refreshToken))
    throw new Error('SHOPIFY_AUTH_REQUIRED')
  let response: Response
  try {
    response = await http(`https://${host}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: env.SHOPIFY_CLIENT_ID ?? '',
        client_secret: env.SHOPIFY_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('SHOPIFY_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('SHOPIFY_RATE_LIMITED')
  if (!response.ok) throw new Error('SHOPIFY_REFRESH_INVALID_GRANT')
  return tokenSet.parse(await boundedJson(response, 65536))
}

export async function graphql(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  http: typeof fetch = globalThis.fetch,
): Promise<unknown> {
  const host = shopDomain.parse(shop)
  if (!accessToken || /[\r\n]/.test(accessToken))
    throw new Error('SHOPIFY_AUTH_REQUIRED')
  let response: Response
  try {
    response = await http(
      `https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    )
  } catch {
    throw new Error('SHOPIFY_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('SHOPIFY_RATE_LIMITED')
  if ([401, 403].includes(response.status))
    throw new Error('SHOPIFY_AUTH_REQUIRED')
  if (!response.ok) throw new Error('SHOPIFY_READ_FAILED')
  const body = z
    .object({
      data: z.unknown().optional(),
      errors: z.array(z.object({ message: z.string() })).optional(),
    })
    .parse(await boundedJson(response, 1_048_576))
  if (body.errors?.length) throw new Error('SHOPIFY_READ_FAILED')
  return body.data
}

export async function readShop(
  shop: string,
  accessToken: string,
  http: typeof fetch = globalThis.fetch,
): Promise<ShopInformation> {
  const data = await graphql(
    shop,
    accessToken,
    '{ shop { id name myshopifyDomain currencyCode primaryDomain { host } } }',
    {},
    http,
  )
  return z.object({ shop: shopInformation }).parse(data).shop
}

/** The shop that answered must be the shop that was authorised. */
export function verifyShop(shop: string, info: ShopInformation) {
  if (info.myshopifyDomain !== shopDomain.parse(shop))
    throw new Error('SHOPIFY_WRONG_SHOP')
  return info
}
