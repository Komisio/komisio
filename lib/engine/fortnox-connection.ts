import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authorizeUrl,
  exchangeCode,
  fortnoxEnvironment,
  fortnoxIssue,
  readCompanyInformation,
  refreshTokens,
  verifyCompany,
  type FortnoxEnvironment,
  type TokenSet,
} from '../../extensions/fortnox/auth'
import {
  credentialKeyConfigured,
  open,
  seal,
  sealedBox,
  signState,
  verifyState,
} from '../platform/credentials'

// The store's Fortnox connection: start the OAuth round trip, complete it by
// verifying the company and sealing the tokens, check it read-only, refresh
// when needed, disconnect. All database writes go through engine functions;
// the tokens exist in clear text only inside a request on the server.
const PURPOSE = 'fortnox-connection'
const STATE_TTL = 600

export const connectionStatus = z.object({
  connected: z.boolean(),
  databaseNumber: z.string().nullable(),
  companyName: z.string().nullable(),
  organisationNumber: z.string().nullable(),
  scope: z.string().nullable(),
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
export type FortnoxConnectionStatus = z.infer<typeof connectionStatus>

export async function readFortnoxStatus(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('fortnox_connection_status', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  // The application can deploy minutes before its migration; until the RPC
  // exists the page reads as "not connected" instead of failing.
  if (r.error?.code === 'PGRST202')
    return connectionStatus.parse({
      connected: false,
      databaseNumber: null,
      companyName: null,
      organisationNumber: null,
      scope: null,
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

function ready(tenantId: string, source: FortnoxEnvironment) {
  const env = fortnoxEnvironment(source)
  if (fortnoxIssue(tenantId, env)) throw new Error('FORTNOX_NOT_CONNECTED')
  if (!credentialKeyConfigured(source as Record<string, string | undefined>))
    throw new Error('CREDENTIAL_KEY_MISSING')
  return env
}

/** The authorisation URL and the signed state the callback must return. */
export async function startFortnoxConnection(
  client: SupabaseClient,
  tenantId: string,
  redirectUri: string,
  source: Record<string, string | undefined>,
  companyInput?: string,
) {
  await requireOwner(client, tenantId)
  const env = ready(tenantId, source)
  const connection = await readFortnoxStatus(client, tenantId)
  const companyName = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .parse(connection.companyName ?? companyInput)
  const state = signState(
    PURPOSE,
    {
      tenantId,
      companyName,
      databaseNumber: connection.databaseNumber ?? '',
    },
    STATE_TTL,
    source,
  )
  return { url: authorizeUrl(env, redirectUri, state), state }
}

const stored = z.object({
  databaseNumber: z.string(),
  companyName: z.string(),
  organisationNumber: z.string(),
  cipher: sealedBox,
  scope: z.string(),
  expiresAt: z.string(),
  revision: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
})

async function persist(
  client: SupabaseClient,
  tenantId: string,
  company: {
    CompanyName: string
    OrganizationNumber: string
    DatabaseNumber: string
  },
  tokens: TokenSet,
  source: Record<string, string | undefined>,
) {
  const cipher = seal(
    PURPOSE,
    { accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
    source,
  )
  const r = await client.rpc('store_fortnox_connection', {
    p_tenant: tenantId,
    p_database_number: company.DatabaseNumber,
    p_company_name: company.CompanyName,
    p_organisation_number: company.OrganizationNumber,
    p_cipher: cipher,
    p_scope: tokens.scope ?? '',
    p_expires_at: new Date(
      Date.now() + Math.max(60, tokens.expires_in - 60) * 1000,
    ).toISOString(),
  })
  if (r.error) throw new Error(r.error.message)
}

/**
 * The callback: verify the state, exchange the code, read the company,
 * refuse anything but the pinned company (recording the refusal without the
 * token), then seal and store.
 */
export async function completeFortnoxConnection(
  client: SupabaseClient,
  input: { code: string; state: string | null; cookieState: string | null },
  redirectUri: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const state = verifyState(PURPOSE, input.state, source)
  if (!state || !input.cookieState || input.cookieState !== input.state)
    throw new Error('FORTNOX_STATE_INVALID')
  const tenantId = z.uuid().parse(state.tenantId)
  await requireOwner(client, tenantId)
  const env = ready(tenantId, source)
  const tokens = await exchangeCode(env, input.code, redirectUri, http)
  const company = await readCompanyInformation(tokens.access_token, http)
  try {
    const companyName = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(
        state.companyName ??
          (source.FORTNOX_PILOT_TENANT_ID === tenantId
            ? source.FORTNOX_EXPECTED_COMPANY_NAME
            : undefined),
      )
    verifyCompany(
      {
        ...env,
        FORTNOX_EXPECTED_COMPANY_NAME: companyName,
        FORTNOX_EXPECTED_DATABASE_NUMBER:
          typeof state.databaseNumber === 'string'
            ? state.databaseNumber
            : source.FORTNOX_PILOT_TENANT_ID === tenantId
              ? source.FORTNOX_EXPECTED_DATABASE_NUMBER
              : undefined,
      },
      company,
    )
  } catch {
    // The token is dropped here; only the company identity is recorded.
    await client.rpc('record_fortnox_check', {
      p_tenant: tenantId,
      p_kind: 'refused',
      p_detail: {
        company_name: company.CompanyName,
        database_number: company.DatabaseNumber,
        reason: 'FORTNOX_WRONG_COMPANY',
      },
    })
    throw new Error('FORTNOX_WRONG_COMPANY')
  }
  await persist(client, tenantId, company, tokens, source)
  return {
    tenantId,
    companyName: company.CompanyName,
    databaseNumber: company.DatabaseNumber,
  }
}

/** A valid access token for the store, refreshing and re-sealing when close to expiry. */
export async function fortnoxAccessToken(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  z.uuid().parse(tenantId)
  const env = ready(tenantId, source)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.rpc('read_fortnox_connection', {
      p_tenant: tenantId,
    })
    if (response.error) throw new Error('FORBIDDEN')
    if (!response.data) throw new Error('FORTNOX_NOT_CONNECTED')
    const row = stored.parse(response.data)
    const secrets = z
      .object({ accessToken: z.string(), refreshToken: z.string() })
      .parse(open(PURPOSE, row.cipher, source))
    if (Date.parse(row.expiresAt) > Date.now() + 30000)
      return { accessToken: secrets.accessToken, row }
    if (!row.revision) throw new Error('FORTNOX_REFRESH_UNAVAILABLE')
    const recordRefusal = async (reason: 'save_failed' | 'invalid_grant') => {
      await Promise.resolve()
        .then(() =>
          client.rpc('record_fortnox_check', {
            p_tenant: tenantId,
            p_kind: 'refused',
            p_detail: { reason, revision: row.revision },
          }),
        )
        .catch(() => undefined)
    }
    const tokens = await refreshTokens(env, secrets.refreshToken, http).catch(
      async (error: unknown) => {
        if (
          error instanceof Error &&
          error.message === 'FORTNOX_REFRESH_INVALID_GRANT'
        )
          await recordRefusal('invalid_grant')
        throw error
      },
    )
    try {
      const cipher = seal(
        PURPOSE,
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        },
        source,
      )
      const expiresAt = new Date(
        Date.now() + Math.max(60, tokens.expires_in - 60) * 1000,
      ).toISOString()
      const saved = await client.rpc('refresh_fortnox_tokens', {
        p_tenant: tenantId,
        p_revision: row.revision,
        p_cipher: cipher,
        p_scope: tokens.scope ?? row.scope,
        p_expires_at: expiresAt,
      })
      if (saved.error) throw new Error('FORTNOX_REFRESH_SAVE_FAILED')
      if (saved.data?.error !== 'FORTNOX_CONNECTION_CHANGED') {
        const result = z
          .object({
            status: z.literal('refreshed'),
            revision: z.string().regex(/^[1-9]\d*$/),
          })
          .parse(saved.data)
        return {
          accessToken: tokens.access_token,
          row: {
            ...row,
            cipher,
            expiresAt,
            scope: tokens.scope ?? row.scope,
            revision: result.revision,
          },
        }
      }
    } catch {
      await recordRefusal('save_failed')
      throw new Error('FORTNOX_REFRESH_SAVE_FAILED')
    }
  }
  throw new Error('FORTNOX_CONNECTION_CHANGED')
}

/** Read-only: the company Fortnox answers for the stored token, checked against the pins. */
export async function checkFortnoxConnection(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  await requireOwner(client, tenantId)
  const { accessToken, row } = await fortnoxAccessToken(
    client,
    tenantId,
    source,
    http,
  )
  const company = await readCompanyInformation(accessToken, http)
  const env = {
    ...fortnoxEnvironment(source),
    FORTNOX_EXPECTED_COMPANY_NAME: row.companyName,
    FORTNOX_EXPECTED_DATABASE_NUMBER: row.databaseNumber,
  }
  let pinnedDatabase = false
  try {
    pinnedDatabase = verifyCompany(env, company).pinnedDatabase
    if (company.DatabaseNumber !== row.databaseNumber)
      throw new Error('FORTNOX_WRONG_COMPANY')
  } catch {
    await client.rpc('record_fortnox_check', {
      p_tenant: tenantId,
      p_kind: 'refused',
      p_detail: {
        company_name: company.CompanyName,
        database_number: company.DatabaseNumber,
        reason: 'FORTNOX_WRONG_COMPANY',
      },
    })
    throw new Error('FORTNOX_WRONG_COMPANY')
  }
  await client.rpc('record_fortnox_check', {
    p_tenant: tenantId,
    p_kind: 'checked',
    p_detail: {
      company_name: company.CompanyName,
      database_number: company.DatabaseNumber,
      pinned_database: pinnedDatabase,
    },
  })
  return {
    companyName: company.CompanyName,
    databaseNumber: company.DatabaseNumber,
    organisationNumber: company.OrganizationNumber,
    pinnedDatabase,
    checkedAt: new Date().toISOString(),
  }
}

export async function disconnectFortnox(
  client: SupabaseClient,
  tenantId: string,
) {
  await requireOwner(client, tenantId)
  const r = await client.rpc('disconnect_fortnox', { p_tenant: tenantId })
  if (r.error) throw new Error(r.error.message)
  return { disconnected: r.data === true }
}

export const fortnoxErrorCodes = [
  'FORTNOX_CONNECTION_CHANGED',
  'FORTNOX_REFRESH_SAVE_FAILED',
  'FORTNOX_REFRESH_UNAVAILABLE',
  'FORTNOX_REFRESH_INVALID_GRANT',
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'FORTNOX_NOT_CONNECTED',
  'FORTNOX_AUTH_REQUIRED',
  'FORTNOX_CONNECTION_FAILED',
  'FORTNOX_RATE_LIMITED',
  'FORTNOX_READ_FAILED',
  'FORTNOX_WRONG_COMPANY',
  'FORTNOX_STATE_INVALID',
  'CREDENTIAL_KEY_MISSING',
  'CREDENTIAL_UNREADABLE',
  'FORTNOX_ALREADY_SENT',
  'FORTNOX_SEND_IN_PROGRESS',
  'FORTNOX_OUTCOME_UNKNOWN',
  'FORTNOX_PREFLIGHT_FAILED',
  'FORTNOX_CURRENCY_UNSUPPORTED',
  'FORTNOX_VOUCHER_REJECTED',
  'EXPORT_NOT_FOUND',
  'SEND_NOT_FOUND',
  'SEND_NOT_PENDING',
  'REQUEST_CONFLICT',
  'INVALID_INPUT',
] as const
export function fortnoxErrorCode(message: string) {
  return fortnoxErrorCodes.find((c) => c === message) ?? 'REQUEST_FAILED'
}
