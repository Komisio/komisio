import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'
export type PilotEnvironment = {
  ZETTLE_CLIENT_ID?: string
  ZETTLE_API_KEY?: string
  ZETTLE_PILOT_TENANT_ID?: string
  ZETTLE_MERCHANT_ID?: string
}
export function pilotAvailable(tenantId: string, env: PilotEnvironment) {
  return (
    z.uuid().safeParse(tenantId).success &&
    env.ZETTLE_PILOT_TENANT_ID === tenantId &&
    z.uuid().safeParse(env.ZETTLE_CLIENT_ID).success &&
    !!env.ZETTLE_API_KEY?.trim()
  )
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
export async function verifyPilotConnection(
  tenantId: string,
  env: PilotEnvironment,
  http: typeof fetch = globalThis.fetch,
) {
  if (!pilotAvailable(tenantId, env)) throw new Error('ZETTLE_NOT_CONNECTED')
  if (
    env.ZETTLE_MERCHANT_ID &&
    !z.uuid().safeParse(env.ZETTLE_MERCHANT_ID).success
  )
    throw new Error('ZETTLE_NOT_CONNECTED')
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
    // Only this diagnostic projection leaves the adapter; tokens are intentionally not returned or cached.
    return {
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
    ZETTLE_CLIENT_ID: env.ZETTLE_CLIENT_ID,
    ZETTLE_API_KEY: env.ZETTLE_API_KEY,
    ZETTLE_PILOT_TENANT_ID: env.ZETTLE_PILOT_TENANT_ID,
    ZETTLE_MERCHANT_ID: env.ZETTLE_MERCHANT_ID,
  }
}
