import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'

// Fortnox OAuth 2.0 (authorization code) and the one read this slice makes:
// company information. The integration (client id and secret) belongs to the
// developer account; which company a token is for is decided by the person
// who authorises, so the company is verified and pinned before anything is
// stored. Nothing here writes to Fortnox.
export type FortnoxEnvironment = {
  FORTNOX_CLIENT_ID?: string
  FORTNOX_CLIENT_SECRET?: string
  FORTNOX_PILOT_TENANT_ID?: string
  FORTNOX_EXPECTED_COMPANY_NAME?: string
  FORTNOX_EXPECTED_DATABASE_NUMBER?: string
}
export type FortnoxIssue =
  | 'connectionUnavailable'
  | 'connectionTenantMissing'
  | 'connectionClientMissing'
  | 'connectionSecretMissing'
  | 'connectionCompanyNameMissing'
export const FORTNOX_SCOPES = ['companyinformation', 'bookkeeping'] as const

export function fortnoxEnvironment(
  env: Record<string, string | undefined>,
): FortnoxEnvironment {
  return {
    FORTNOX_CLIENT_ID: env.FORTNOX_CLIENT_ID?.trim(),
    FORTNOX_CLIENT_SECRET: env.FORTNOX_CLIENT_SECRET?.trim(),
    FORTNOX_PILOT_TENANT_ID: env.FORTNOX_PILOT_TENANT_ID?.trim(),
    FORTNOX_EXPECTED_COMPANY_NAME: env.FORTNOX_EXPECTED_COMPANY_NAME?.trim(),
    FORTNOX_EXPECTED_DATABASE_NUMBER:
      env.FORTNOX_EXPECTED_DATABASE_NUMBER?.trim(),
  }
}

/** Fixed reason codes only; credentials are inspected only after the tenant match. */
export function fortnoxIssue(
  tenantId: string,
  source: FortnoxEnvironment,
): FortnoxIssue | null {
  const env = fortnoxEnvironment(source)
  if (!env.FORTNOX_PILOT_TENANT_ID) return 'connectionTenantMissing'
  if (
    !z.uuid().safeParse(tenantId).success ||
    env.FORTNOX_PILOT_TENANT_ID !== tenantId
  )
    return 'connectionUnavailable'
  if (!env.FORTNOX_CLIENT_ID || /[\s]/.test(env.FORTNOX_CLIENT_ID))
    return 'connectionClientMissing'
  if (!env.FORTNOX_CLIENT_SECRET) return 'connectionSecretMissing'
  if (!env.FORTNOX_EXPECTED_COMPANY_NAME) return 'connectionCompanyNameMissing'
  return null
}

const AUTH_URL = 'https://apps.fortnox.se/oauth-v1/auth'
const TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token'
const API_URL = 'https://api.fortnox.se/3'

export function authorizeUrl(
  env: FortnoxEnvironment,
  redirectUri: string,
  state: string,
) {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', env.FORTNOX_CLIENT_ID ?? '')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', FORTNOX_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('response_type', 'code')
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
  env: FortnoxEnvironment,
  form: Record<string, string>,
  http: typeof fetch,
) {
  const basic = Buffer.from(
    `${env.FORTNOX_CLIENT_ID}:${env.FORTNOX_CLIENT_SECRET}`,
  ).toString('base64')
  let response: Response
  try {
    response = await http(TOKEN_URL, {
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
    })
  } catch {
    throw new Error('FORTNOX_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('FORTNOX_RATE_LIMITED')
  if (!response.ok && form.grant_type === 'refresh_token') {
    const body = await boundedJson(response, 65536).catch(() => null)
    if (z.object({ error: z.literal('invalid_grant') }).safeParse(body).success)
      throw new Error('FORTNOX_REFRESH_INVALID_GRANT')
  }
  if (!response.ok) throw new Error('FORTNOX_AUTH_REQUIRED')
  const tokens = tokenSet.parse(await boundedJson(response, 65536))
  if (/[\r\n]/.test(tokens.access_token) || /[\r\n]/.test(tokens.refresh_token))
    throw new Error('FORTNOX_AUTH_REQUIRED')
  return tokens
}

export function exchangeCode(
  env: FortnoxEnvironment,
  code: string,
  redirectUri: string,
  http: typeof fetch = globalThis.fetch,
) {
  if (!code || code.length > 4096 || /[\s]/.test(code))
    throw new Error('FORTNOX_AUTH_REQUIRED')
  return tokenRequest(
    env,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    http,
  )
}

/** Fortnox rotates refresh tokens: the returned set replaces the stored one. */
export function refreshTokens(
  env: FortnoxEnvironment,
  refreshToken: string,
  http: typeof fetch = globalThis.fetch,
) {
  return tokenRequest(
    env,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    http,
  )
}

export const companyInformation = z.object({
  CompanyName: z.string().min(1).max(200),
  OrganizationNumber: z.string().max(40).optional().default(''),
  DatabaseNumber: z
    .union([z.number().int(), z.string()])
    .transform(String)
    .pipe(z.string().min(1).max(40)),
})
export type CompanyInformation = z.infer<typeof companyInformation>

export async function readCompanyInformation(
  accessToken: string,
  http: typeof fetch = globalThis.fetch,
): Promise<CompanyInformation> {
  if (!accessToken || /[\r\n]/.test(accessToken))
    throw new Error('FORTNOX_AUTH_REQUIRED')
  let response: Response
  try {
    response = await http(`${API_URL}/companyinformation`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('FORTNOX_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('FORTNOX_RATE_LIMITED')
  if ([401, 403].includes(response.status))
    throw new Error('FORTNOX_AUTH_REQUIRED')
  if (!response.ok) throw new Error('FORTNOX_READ_FAILED')
  const body = z
    .object({ CompanyInformation: companyInformation })
    .parse(await boundedJson(response, 65536))
  return body.CompanyInformation
}

/**
 * The company pins. The name pin is mandatory (the test company shares its
 * organisation number with the production company, so the number cannot
 * distinguish them); the database number pin is applied once the owner has
 * read it from a first check and set it.
 */
export function verifyCompany(
  env: FortnoxEnvironment,
  company: CompanyInformation,
) {
  const name = env.FORTNOX_EXPECTED_COMPANY_NAME?.trim().toLowerCase()
  if (!name || company.CompanyName.trim().toLowerCase() !== name)
    throw new Error('FORTNOX_WRONG_COMPANY')
  const db = env.FORTNOX_EXPECTED_DATABASE_NUMBER?.trim()
  if (db && company.DatabaseNumber !== db)
    throw new Error('FORTNOX_WRONG_COMPANY')
  return { pinnedDatabase: !!db }
}
