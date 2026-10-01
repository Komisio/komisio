import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authorizeUrl,
  companyKey,
  exchangeCode,
  readCompanySettings,
  refreshTokens,
  verifyCompany,
  spirisEnvironment,
  spirisIssue,
  type TokenSet,
  type SpirisEnvironment,
} from '../../extensions/spiris/auth'
import {
  credentialKeyConfigured,
  open,
  seal,
  sealedBox,
  signState,
  verifyState,
} from '../platform/credentials'

// The store's Spiris connection: start the OAuth round trip,
// complete it by verifying the company and sealing the tokens, check it
// read-only, refresh when needed, disconnect. All database writes go through
// engine functions; the tokens exist in clear text only inside a request on
// the server. Same contract as the Fortnox connection.
const PURPOSE = 'spiris-connection'
const STATE_TTL = 600

export const connectionStatus = z.object({
  connected: z.boolean(),
  companyKey: z.string().nullable(),
  companyName: z.string().nullable(),
  organisationNumber: z.string().nullable(),
  currencyCode: z.string().nullable(),
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
export type SpirisConnectionStatus = z.infer<typeof connectionStatus>

export async function readSpirisStatus(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('spiris_connection_status', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  // The application can deploy minutes before its migration; until the RPC
  // exists the page reads as "not connected" instead of failing.
  if (r.error?.code === 'PGRST202')
    return connectionStatus.parse({
      connected: false,
      companyKey: null,
      companyName: null,
      organisationNumber: null,
      currencyCode: null,
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

function ready(source: Record<string, string | undefined>): SpirisEnvironment {
  const env = spirisEnvironment(source)
  if (spirisIssue(env)) throw new Error('SPIRIS_NOT_CONNECTED')
  if (!credentialKeyConfigured(source))
    throw new Error('CREDENTIAL_KEY_MISSING')
  return env
}

/** The authorisation URL and the signed state the callback must return. */
export async function startSpirisConnection(
  client: SupabaseClient,
  tenantId: string,
  redirectUri: string,
  source: Record<string, string | undefined>,
  companyInput?: string,
) {
  await requireOwner(client, tenantId)
  const env = ready(source)
  const connection = await readSpirisStatus(client, tenantId)
  const companyName = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .parse(connection.companyName ?? companyInput)
  const state = signState(
    PURPOSE,
    { tenantId, companyName, companyKey: connection.companyKey ?? '' },
    STATE_TTL,
    source,
  )
  return { url: authorizeUrl(env, redirectUri, state), state }
}

const stored = z.object({
  companyKey: z.string(),
  companyName: z.string(),
  organisationNumber: z.string(),
  currencyCode: z.string(),
  cipher: sealedBox,
  scope: z.string(),
  expiresAt: z.string(),
  revision: z.string().regex(/^[1-9]\d*$/),
})

function expiry(tokens: TokenSet) {
  return new Date(
    Date.now() + Math.max(60, tokens.expires_in - 60) * 1000,
  ).toISOString()
}

/**
 * The callback: verify the state, exchange the code, read the company,
 * refuse anything but the pinned company (recording the refusal without the
 * token), then seal and store.
 */
export async function completeSpirisConnection(
  client: SupabaseClient,
  input: { code: string; state: string | null; cookieState: string | null },
  redirectUri: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const state = verifyState(PURPOSE, input.state, source)
  if (!state || !input.cookieState || input.cookieState !== input.state)
    throw new Error('SPIRIS_STATE_INVALID')
  const tenantId = z.uuid().parse(state.tenantId)
  await requireOwner(client, tenantId)
  const env = ready(source)
  const tokens = await exchangeCode(env, input.code, redirectUri, http)
  const company = await readCompanySettings(env, tokens.access_token, http)
  try {
    verifyCompany(
      {
        companyName:
          typeof state.companyName === 'string' ? state.companyName : '',
        companyKey:
          typeof state.companyKey === 'string' ? state.companyKey : undefined,
      },
      company,
    )
  } catch {
    // The token is dropped here; only the company identity is recorded.
    await client.rpc('record_spiris_check', {
      p_tenant: tenantId,
      p_kind: 'refused',
      p_detail: {
        company_name: company.Name,
        company_key: companyKey(company),
        reason: 'SPIRIS_WRONG_COMPANY',
      },
    })
    throw new Error('SPIRIS_WRONG_COMPANY')
  }
  const r = await client.rpc('store_spiris_connection', {
    p_tenant: tenantId,
    p_company_key: companyKey(company),
    p_company_name: company.Name,
    p_organisation_number: company.CorporateIdentityNumber,
    p_currency_code: company.CurrencyCode,
    p_cipher: seal(
      PURPOSE,
      { accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
      source,
    ),
    p_scope: tokens.scope ?? '',
    p_expires_at: expiry(tokens),
  })
  if (r.error) throw new Error(r.error.message)
  return {
    tenantId,
    companyName: company.Name,
    companyKey: companyKey(company),
    currencyCode: company.CurrencyCode,
  }
}

/** A valid access token for the store, refreshing and re-sealing when close to expiry. */
export async function spirisAccessToken(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  z.uuid().parse(tenantId)
  const env = ready(source)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.rpc('read_spiris_connection', {
      p_tenant: tenantId,
    })
    if (response.error) throw new Error('FORBIDDEN')
    if (!response.data) throw new Error('SPIRIS_NOT_CONNECTED')
    const row = stored.parse(response.data)
    const secrets = z
      .object({ accessToken: z.string(), refreshToken: z.string() })
      .parse(open(PURPOSE, row.cipher, source))
    if (Date.parse(row.expiresAt) > Date.now() + 30000)
      return { env, accessToken: secrets.accessToken, row }
    const recordRefusal = async (reason: 'save_failed' | 'invalid_grant') => {
      await Promise.resolve()
        .then(() =>
          client.rpc('record_spiris_check', {
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
          error.message === 'SPIRIS_REFRESH_INVALID_GRANT'
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
      const expiresAt = expiry(tokens)
      const saved = await client.rpc('refresh_spiris_tokens', {
        p_tenant: tenantId,
        p_revision: row.revision,
        p_cipher: cipher,
        p_scope: tokens.scope ?? row.scope,
        p_expires_at: expiresAt,
      })
      if (saved.error) throw new Error('SPIRIS_REFRESH_SAVE_FAILED')
      if (saved.data?.error !== 'SPIRIS_CONNECTION_CHANGED') {
        const result = z
          .object({
            status: z.literal('refreshed'),
            revision: z.string().regex(/^[1-9]\d*$/),
          })
          .parse(saved.data)
        return {
          env,
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
      throw new Error('SPIRIS_REFRESH_SAVE_FAILED')
    }
  }
  throw new Error('SPIRIS_CONNECTION_CHANGED')
}

/** Read-only: the company Spiris answers for the stored token, checked against the pins. */
export async function checkSpirisConnection(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  await requireOwner(client, tenantId)
  const { env, accessToken, row } = await spirisAccessToken(
    client,
    tenantId,
    source,
    http,
  )
  const company = await readCompanySettings(env, accessToken, http)
  try {
    verifyCompany(
      { companyName: row.companyName, companyKey: row.companyKey },
      company,
    )
  } catch {
    await client.rpc('record_spiris_check', {
      p_tenant: tenantId,
      p_kind: 'refused',
      p_detail: {
        company_name: company.Name,
        company_key: companyKey(company),
        reason: 'SPIRIS_WRONG_COMPANY',
      },
    })
    throw new Error('SPIRIS_WRONG_COMPANY')
  }
  await client.rpc('record_spiris_check', {
    p_tenant: tenantId,
    p_kind: 'checked',
    p_detail: {
      company_name: company.Name,
      company_key: companyKey(company),
      currency_code: company.CurrencyCode,
    },
  })
  return {
    companyName: company.Name,
    companyKey: companyKey(company),
    organisationNumber: company.CorporateIdentityNumber,
    currencyCode: company.CurrencyCode,
    checkedAt: new Date().toISOString(),
  }
}

export async function disconnectSpiris(
  client: SupabaseClient,
  tenantId: string,
) {
  await requireOwner(client, tenantId)
  const r = await client.rpc('disconnect_spiris', { p_tenant: tenantId })
  if (r.error) throw new Error(r.error.message)
  return { disconnected: r.data === true }
}

export const spirisErrorCodes = [
  'SPIRIS_CONNECTION_CHANGED',
  'SPIRIS_REFRESH_SAVE_FAILED',
  'SPIRIS_REFRESH_INVALID_GRANT',
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'SPIRIS_NOT_CONNECTED',
  'SPIRIS_AUTH_REQUIRED',
  'SPIRIS_CONNECTION_FAILED',
  'SPIRIS_RATE_LIMITED',
  'SPIRIS_READ_FAILED',
  'SPIRIS_WRONG_COMPANY',
  'SPIRIS_STATE_INVALID',
  'CREDENTIAL_KEY_MISSING',
  'CREDENTIAL_UNREADABLE',
  'SPIRIS_ALREADY_SENT',
  'SPIRIS_SEND_IN_PROGRESS',
  'SPIRIS_OUTCOME_UNKNOWN',
  'SPIRIS_PREFLIGHT_FAILED',
  'SPIRIS_CURRENCY_MISMATCH',
  'SPIRIS_VOUCHER_REJECTED',
  'EXPORT_NOT_FOUND',
  'SEND_NOT_FOUND',
  'SEND_NOT_PENDING',
  'REQUEST_CONFLICT',
  'INVALID_INPUT',
] as const
export function spirisErrorCode(message: string) {
  return spirisErrorCodes.find((c) => c === message) ?? 'REQUEST_FAILED'
}
