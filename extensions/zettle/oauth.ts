import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'

// https://developer.zettle.com/docs/api/oauth/api-reference
export const PAYPAL_SCOPES =
  'READ:USERINFO READ:PRODUCT WRITE:PRODUCT READ:PURCHASE'
const secret = z
  .string()
  .min(1)
  .max(32768)
  .regex(/^[^\s\x00-\x1f\x7f]+$/)
export const paypalTokens = z.object({
  access_token: secret,
  refresh_token: secret,
  expires_in: z.coerce.number().int().min(120).max(86400),
  token_type: z.string().optional(),
  scope: z.string().max(4096).optional(),
})
export function paypalClientId(source: Record<string, string | undefined>) {
  const result = secret.safeParse(source.PAYPAL_POS_CLIENT_ID?.trim())
  if (!result.success) throw new Error('PAYPAL_APP_UNAVAILABLE')
  return result.data
}
export function paypalClientSecret(source: Record<string, string | undefined>) {
  const result = secret.safeParse(source.PAYPAL_POS_CLIENT_SECRET?.trim())
  if (!result.success) throw new Error('PAYPAL_APP_UNAVAILABLE')
  return result.data
}
export function paypalAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
) {
  const url = new URL('https://oauth.zettle.com/authorize')
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: PAYPAL_SCOPES,
  }).toString()
  return url.toString()
}
export async function paypalTokenRequest(
  fields: Record<string, string>,
  http: typeof fetch = fetch,
) {
  try {
    const response = await http('https://oauth.zettle.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(fields).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
    if (!response.ok) {
      const body = await boundedJson(response, 8192).catch(() => null)
      const code = z.object({ error: z.string() }).safeParse(body)
      if (
        code.success &&
        ['invalid_client', 'unauthorized_client'].includes(code.data.error)
      )
        throw new Error('PAYPAL_APP_AUTH_FAILED')
      throw new Error('ZETTLE_AUTH_REQUIRED')
    }
    const tokens = paypalTokens.parse(await boundedJson(response, 100000))
    if (tokens.token_type && tokens.token_type.toLowerCase() !== 'bearer')
      throw new Error('ZETTLE_AUTH_REQUIRED')
    if (
      tokens.scope &&
      PAYPAL_SCOPES.split(' ').some(
        (s) => !tokens.scope!.split(' ').includes(s),
      )
    )
      throw new Error('ZETTLE_AUTH_REQUIRED')
    return tokens
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'ZETTLE_AUTH_REQUIRED',
        'ZETTLE_RATE_LIMITED',
        'PAYPAL_APP_AUTH_FAILED',
      ].includes(error.message)
    )
      throw error
    throw new Error('ZETTLE_CONNECTION_FAILED')
  }
}
export async function paypalMerchant(
  accessToken: string,
  http: typeof fetch = fetch,
) {
  try {
    const response = await http('https://oauth.zettle.com/users/self', {
      headers: {
        Authorization: `Bearer ${secret.parse(accessToken)}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
    if (!response.ok) throw new Error('ZETTLE_AUTH_REQUIRED')
    return z
      .object({ organizationUuid: z.uuid() })
      .parse(await boundedJson(response, 8192)).organizationUuid
  } catch (error) {
    if (
      error instanceof Error &&
      ['ZETTLE_AUTH_REQUIRED', 'ZETTLE_RATE_LIMITED'].includes(error.message)
    )
      throw error
    throw new Error('ZETTLE_CONNECTION_FAILED')
  }
}
