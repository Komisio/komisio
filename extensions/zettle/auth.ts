import { z } from 'zod'
import { zettleHttpClient } from './http'
import { boundedJson } from '../../lib/http/bounded-json'
export type PilotEnvironment = {
  ZETTLE_CLIENT_ID?: string
  ZETTLE_API_KEY?: string
  ZETTLE_PILOT_TENANT_ID?: string
  ZETTLE_MERCHANT_ID?: string
}
export type PilotIssue =
  | 'connectionUnavailable'
  | 'connectionTenantMissing'
  | 'connectionClientMissing'
  | 'connectionKeyMissing'
  | 'connectionMerchantInvalid'
/** Safe diagnostic codes only. Inspect credentials only after the explicit tenant match. */
export function pilotIssue(
  tenantId: string,
  source: PilotEnvironment,
): PilotIssue | null {
  const env = pilotEnvironment(source)
  if (!env.ZETTLE_PILOT_TENANT_ID) return 'connectionTenantMissing'
  if (
    !z.uuid().safeParse(tenantId).success ||
    env.ZETTLE_PILOT_TENANT_ID !== tenantId
  )
    return 'connectionUnavailable'
  // OAuth specifies an opaque string, not a UUID. The provider validates the ID.
  if (
    !env.ZETTLE_CLIENT_ID ||
    env.ZETTLE_CLIENT_ID.length > 4096 ||
    Array.from(env.ZETTLE_CLIENT_ID).some(
      (c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127,
    )
  )
    return 'connectionClientMissing'
  if (!env.ZETTLE_API_KEY) return 'connectionKeyMissing'
  if (
    env.ZETTLE_MERCHANT_ID &&
    !z.uuid().safeParse(env.ZETTLE_MERCHANT_ID).success
  )
    return 'connectionMerchantInvalid'
  return null
}
export function pilotAvailable(tenantId: string, env: PilotEnvironment) {
  return pilotIssue(tenantId, env) === null
}
const tokenResponse = z.object({
  access_token: z.string().min(1).max(32768),
  expires_in: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform(Number)
    .pipe(z.number().int().min(1).max(86400)),
  token_type: z.string().optional(),
  scope: z.string().max(4096).optional(),
})
/** Assertion grant, official /token endpoint. Errors never contain provider bodies or credentials. */
async function acquirePilotSession(
  tenantId: string,
  source: PilotEnvironment,
  http: typeof fetch = globalThis.fetch,
) {
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env)) throw new Error('ZETTLE_NOT_CONNECTED')
  try {
    const response = await http('https://oauth.zettle.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: env.ZETTLE_CLIENT_ID!,
        assertion: env.ZETTLE_API_KEY!,
      }).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
    if (!response.ok) throw new Error('ZETTLE_AUTH_REQUIRED')
    const token = tokenResponse.parse(await boundedJson(response, 65536))
    if (token.token_type && token.token_type.toLowerCase() !== 'bearer')
      throw new Error('ZETTLE_AUTH_REQUIRED')
    if (/[\r\n]/.test(token.access_token))
      throw new Error('ZETTLE_AUTH_REQUIRED')
    const identity = await http('https://oauth.zettle.com/users/self', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (identity.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
    if (!identity.ok) throw new Error('ZETTLE_AUTH_REQUIRED')
    const user = z
      .object({ organizationUuid: z.uuid() })
      .parse(await boundedJson(identity, 8192))
    if (
      env.ZETTLE_MERCHANT_ID &&
      user.organizationUuid !== env.ZETTLE_MERCHANT_ID
    )
      throw new Error('ZETTLE_WRONG_MERCHANT')
    // Private server lease. Only the public diagnostic projection or transport leaves this module.
    return {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      organizationId: user.organizationUuid,
      merchantPinned: !!env.ZETTLE_MERCHANT_ID,
      checkedAt: new Date().toISOString(),
    }
  } catch (e) {
    if (
      e instanceof Error &&
      [
        'ZETTLE_RATE_LIMITED',
        'ZETTLE_AUTH_REQUIRED',
        'ZETTLE_WRONG_MERCHANT',
      ].includes(e.message)
    )
      throw new Error(e.message)
    throw new Error('ZETTLE_CONNECTION_FAILED')
  }
}

/** Explicit server configuration projection; never pass this object to a client component. */
export function pilotEnvironment(
  env: Record<string, string | undefined>,
): PilotEnvironment {
  return {
    ZETTLE_CLIENT_ID: env.ZETTLE_CLIENT_ID?.trim(),
    ZETTLE_API_KEY: env.ZETTLE_API_KEY?.trim(),
    ZETTLE_PILOT_TENANT_ID: env.ZETTLE_PILOT_TENANT_ID?.trim(),
    ZETTLE_MERCHANT_ID: env.ZETTLE_MERCHANT_ID?.trim(),
  }
}

/** Never return an access token to the engine, route or browser. */
export async function verifyPilotConnection(
  tenantId: string,
  source: PilotEnvironment,
  http: typeof fetch = globalThis.fetch,
) {
  const { organizationId, merchantPinned, checkedAt } =
    await acquirePilotSession(tenantId, source, http)
  return { organizationId, merchantPinned, checkedAt }
}
/** A per-invocation client with a mandatory merchant pin, no global token cache. */
export async function connectedPilotClient(
  tenantId: string,
  source: PilotEnvironment,
  window: { startDate: string; endDate: string },
  http: typeof fetch = globalThis.fetch,
) {
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  let lease = await acquirePilotSession(tenantId, env, http)
  return zettleHttpClient({
    organizationId: env.ZETTLE_MERCHANT_ID,
    ...window,
    fetch: http,
    accessToken: async () => {
      if (lease.expiresAt <= Date.now() + 30000)
        lease = await acquirePilotSession(tenantId, env, http)
      return lease.accessToken
    },
  })
}
