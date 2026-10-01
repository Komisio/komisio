import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'

// Spiris (formerly Visma eAccounting) OAuth 2.0 (authorization code, offline access)
// and the one read the connection makes: company settings. The integration
// (client id and secret) belongs to the developer account; which company a
// token is for is decided by the person who authorises, so the company is
// verified and pinned before anything is stored. Nothing here writes to Spiris.
// The identity and API hosts default to production and can be pointed at
// Spiris's sandbox through the environment.
export type SpirisEnvironment = {
  SPIRIS_CLIENT_ID?: string
  SPIRIS_CLIENT_SECRET?: string
  SPIRIS_IDENTITY_URL?: string
  SPIRIS_API_URL?: string
}
export type SpirisIssue = 'connectionClientMissing' | 'connectionSecretMissing'
export const SPIRIS_SCOPES = [
  'ea:api',
  'ea:accounting',
  'offline_access',
] as const
const IDENTITY_URL = 'https://identity.vismaonline.com'
const API_URL = 'https://eaccountingapi.vismaonline.com/v2'

function host(value: string | undefined, fallback: string) {
  const trimmed = value?.trim().replace(/\/+$/, '')
  return trimmed && /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(trimmed)
    ? trimmed
    : fallback
}

export function spirisEnvironment(
  env: Record<string, string | undefined>,
): SpirisEnvironment {
  return {
    SPIRIS_CLIENT_ID: env.SPIRIS_CLIENT_ID?.trim(),
    SPIRIS_CLIENT_SECRET: env.SPIRIS_CLIENT_SECRET?.trim(),
    SPIRIS_IDENTITY_URL: host(env.SPIRIS_IDENTITY_URL, IDENTITY_URL),
    SPIRIS_API_URL: host(env.SPIRIS_API_URL, API_URL),
  }
}

/** Host OAuth application readiness; membership and company binding are enforced by the engine. */
export function spirisIssue(source: SpirisEnvironment): SpirisIssue | null {
  const env = spirisEnvironment(source)
  if (!env.SPIRIS_CLIENT_ID || /[\s]/.test(env.SPIRIS_CLIENT_ID))
    return 'connectionClientMissing'
  if (!env.SPIRIS_CLIENT_SECRET) return 'connectionSecretMissing'
  return null
}

export function spirisApiUrl(env: SpirisEnvironment) {
  return env.SPIRIS_API_URL ?? API_URL
}

export function authorizeUrl(
  env: SpirisEnvironment,
  redirectUri: string,
  state: string,
) {
  const url = new URL(
    `${env.SPIRIS_IDENTITY_URL ?? IDENTITY_URL}/connect/authorize`,
  )
  url.searchParams.set('client_id', env.SPIRIS_CLIENT_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SPIRIS_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export const tokenSet = z.object({
  access_token: z.string().min(1).max(32768),
  refresh_token: z.string().min(1).max(32768),
  expires_in: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform(Number)
    .pipe(z.number().int().min(1).max(86400)),
  scope: z.string().max(4096).optional(),
  token_type: z.string().optional(),
})
export type TokenSet = z.infer<typeof tokenSet>

async function tokenRequest(
  env: SpirisEnvironment,
  form: Record<string, string>,
  http: typeof fetch,
) {
  const basic = Buffer.from(
    `${env.SPIRIS_CLIENT_ID}:${env.SPIRIS_CLIENT_SECRET}`,
  ).toString('base64')
  let response: Response
  try {
    response = await http(
      `${env.SPIRIS_IDENTITY_URL ?? IDENTITY_URL}/connect/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(form).toString(),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      },
    )
  } catch {
    throw new Error('SPIRIS_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('SPIRIS_RATE_LIMITED')
  if (!response.ok && form.grant_type === 'refresh_token') {
    const body = await boundedJson(response, 65536).catch(() => null)
    if (z.object({ error: z.literal('invalid_grant') }).safeParse(body).success)
      throw new Error('SPIRIS_REFRESH_INVALID_GRANT')
  }
  if (!response.ok) throw new Error('SPIRIS_AUTH_REQUIRED')
  const tokens = tokenSet.parse(await boundedJson(response, 65536))
  if (/[\r\n]/.test(tokens.access_token) || /[\r\n]/.test(tokens.refresh_token))
    throw new Error('SPIRIS_AUTH_REQUIRED')
  return tokens
}

export function exchangeCode(
  env: SpirisEnvironment,
  code: string,
  redirectUri: string,
  http: typeof fetch = globalThis.fetch,
) {
  if (!code || code.length > 4096 || /[\s]/.test(code))
    throw new Error('SPIRIS_AUTH_REQUIRED')
  return tokenRequest(
    env,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    http,
  )
}

/** Spiris issues a new refresh token on every renewal: the returned set replaces the stored one. */
export function refreshTokens(
  env: SpirisEnvironment,
  refreshToken: string,
  http: typeof fetch = globalThis.fetch,
) {
  return tokenRequest(
    env,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    http,
  )
}

// Company settings as Spiris returns them. Spiris reports no database id;
// the corporate identity number, or the normalised name when a company has
// none, is the key the connection is bound to.
export const companySettings = z.object({
  Name: z.string().trim().min(1).max(200),
  CorporateIdentityNumber: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => v?.trim() ?? ''),
  CurrencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((v) => v.toUpperCase()),
})
export type CompanySettings = z.infer<typeof companySettings>

export function companyKey(company: CompanySettings) {
  return (
    company.CorporateIdentityNumber.replace(/[\s-]/g, '') ||
    `name:${company.Name.toLowerCase()}`
  ).slice(0, 80)
}

export async function readCompanySettings(
  env: SpirisEnvironment,
  accessToken: string,
  http: typeof fetch = globalThis.fetch,
): Promise<CompanySettings> {
  if (!accessToken || /[\r\n]/.test(accessToken))
    throw new Error('SPIRIS_AUTH_REQUIRED')
  let response: Response
  try {
    response = await http(`${spirisApiUrl(env)}/companysettings`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('SPIRIS_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('SPIRIS_RATE_LIMITED')
  if ([401, 403].includes(response.status))
    throw new Error('SPIRIS_AUTH_REQUIRED')
  if (!response.ok) throw new Error('SPIRIS_READ_FAILED')
  return companySettings.parse(await boundedJson(response, 65536))
}

/**
 * The company pins: the name the owner typed is mandatory, and once the
 * connection exists its company key is compared as well.
 */
export function verifyCompany(
  expected: { companyName?: string; companyKey?: string },
  company: CompanySettings,
) {
  const name = expected.companyName?.trim().toLowerCase()
  if (!name || company.Name.trim().toLowerCase() !== name)
    throw new Error('SPIRIS_WRONG_COMPANY')
  const key = expected.companyKey?.trim()
  if (key && companyKey(company) !== key)
    throw new Error('SPIRIS_WRONG_COMPANY')
  return { pinnedKey: !!key }
}
