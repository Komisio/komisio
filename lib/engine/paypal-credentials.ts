import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  open,
  seal,
  sealedBox,
  signState,
  verifyState,
  credentialKeyConfigured,
} from '../platform/credentials'
import {
  paypalAuthorizeUrl,
  paypalClientId,
  paypalClientSecret,
  paypalMerchant,
  paypalTokenRequest,
  paypalTokens,
} from '../../extensions/zettle/oauth'
const purpose = (tenantId: string) => `paypal-oauth:${tenantId}`
const STATE = 'paypal-oauth-state'
export const PAYPAL_COOKIE = 'komisio-paypal-oauth'
export function paypalAppAvailable(source: Record<string, string | undefined>) {
  try {
    paypalClientId(source)
    paypalClientSecret(source)
    return credentialKeyConfigured(source)
  } catch {
    return false
  }
}
const statusSchema = z.object({
  connected: z.boolean(),
  merchantId: z.uuid().nullable(),
  revision: z.string().regex(/^\d+$/),
  reconnectRequired: z.boolean(),
})
export async function readPayPalStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('paypal_connection_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error) throw new Error('FORBIDDEN')
  return statusSchema.parse(r.data)
}
async function owner(client: SupabaseClient, tenantId: string, userId: string) {
  const identity = await client.auth.getUser()
  if (identity.error || identity.data.user?.id !== userId)
    throw new Error('FORBIDDEN')
  const r = await client.rpc('tenant_role', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error || !['owner', 'admin'].includes(r.data ?? ''))
    throw new Error('FORBIDDEN')
}
export async function startPayPalConnection(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  redirectUri: string,
  source: Record<string, string | undefined>,
) {
  await owner(client, tenantId, userId)
  if (!paypalAppAvailable(source)) throw new Error('PAYPAL_APP_UNAVAILABLE')
  const current = await readPayPalStatus(client, tenantId)
  const state = signState(
    STATE,
    { tenantId, userId, revision: current.revision, nonce: randomUUID() },
    600,
    source,
  )
  const cookie = Buffer.from(
    JSON.stringify(seal(STATE, { state, redirectUri }, source)),
  ).toString('base64url')
  return {
    cookie,
    url: paypalAuthorizeUrl(paypalClientId(source), redirectUri, state),
  }
}
export async function completePayPalConnection(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  input: { code: string; state: string | null; cookie: string | null },
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  await owner(client, tenantId, userId)
  const state = verifyState(STATE, input.state, source)
  if (
    !state ||
    state.tenantId !== tenantId ||
    state.userId !== userId ||
    !input.cookie ||
    input.cookie.length > 8192
  )
    throw new Error('PAYPAL_STATE_INVALID')
  let bound: { state: string; redirectUri: string }
  try {
    bound = z
      .object({
        state: z.string(),
        redirectUri: z.url(),
      })
      .parse(
        open(
          STATE,
          JSON.parse(Buffer.from(input.cookie, 'base64url').toString()),
          source,
        ),
      )
  } catch {
    throw new Error('PAYPAL_STATE_INVALID')
  }
  if (bound.state !== input.state) throw new Error('PAYPAL_STATE_INVALID')
  const current = await readPayPalStatus(client, tenantId)
  if (current.revision !== state.revision)
    throw new Error('PAYPAL_CONNECTION_CHANGED')
  const code = z.string().min(1).max(4096).parse(input.code)
  const tokens = await paypalTokenRequest(
    {
      grant_type: 'authorization_code',
      client_id: paypalClientId(source),
      client_secret: paypalClientSecret(source),
      redirect_uri: bound.redirectUri,
      code,
    },
    http,
  )
  const expiresAt = new Date(
    Date.now() + (tokens.expires_in - 30) * 1000,
  ).toISOString()
  const merchant = await paypalMerchant(tokens.access_token, http)
  if (current.merchantId && current.merchantId !== merchant)
    throw new Error('ZETTLE_WRONG_MERCHANT')
  const r = await client.rpc('store_paypal_oauth', {
    p_tenant: tenantId,
    p_merchant: merchant,
    p_cipher: seal(purpose(tenantId), tokens, source),
    p_expires_at: expiresAt,
    p_revision: state.revision,
  })
  if (r.error) throw new Error(paypalErrorCode(r.error.message))
  return { organizationId: merchant }
}
const stored = z.object({
  merchantId: z.uuid(),
  cipher: sealedBox,
  expiresAt: z.string(),
  revision: z.string().regex(/^\d+$/),
})
/** Database-authorized access only; no deployment credential fallback. */
export async function paypalEnvironment(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
): Promise<Record<string, string | undefined>> {
  z.uuid().parse(tenantId)
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await client.rpc('read_paypal_credentials', {
      p_tenant: tenantId,
    })
    if (result.error) throw new Error('FORBIDDEN')
    if (!result.data) return {}
    const row = stored.parse(result.data)
    let tokens = paypalTokens.parse(open(purpose(tenantId), row.cipher, source))
    let expiresAt = Date.parse(row.expiresAt)
    if (!Number.isFinite(expiresAt)) throw new Error('CREDENTIAL_UNREADABLE')
    if (expiresAt <= Date.now() + 60000) {
      // Validate host configuration before claiming a single-use refresh token.
      const clientId = paypalClientId(source)
      const clientSecret = paypalClientSecret(source)
      const claim = randomUUID()
      const r = await client.rpc('claim_paypal_refresh', {
        p_tenant: tenantId,
        p_revision: row.revision,
        p_claim: claim,
      })
      if (r.error) throw new Error(paypalErrorCode(r.error.message))
      if (r.data?.status === 'changed' || r.data?.status === 'valid') continue
      if (r.data?.status === 'busy') throw new Error('PAYPAL_REFRESH_BUSY')
      if (r.data?.status !== 'claimed')
        throw new Error('PAYPAL_RECONNECT_REQUIRED')
      // The provider may rotate the token even if its HTTP response never arrives.
      tokens = await paypalTokenRequest(
        {
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refresh_token,
        },
        http,
      )
      if ((await paypalMerchant(tokens.access_token, http)) !== row.merchantId)
        throw new Error('ZETTLE_WRONG_MERCHANT')
      expiresAt = Date.now() + (tokens.expires_in - 30) * 1000
      const saved = await client.rpc('finish_paypal_refresh', {
        p_tenant: tenantId,
        p_revision: row.revision,
        p_claim: claim,
        p_cipher: seal(purpose(tenantId), tokens, source),
        p_expires_at: new Date(expiresAt).toISOString(),
      })
      if (saved.error) throw new Error('PAYPAL_RECONNECT_REQUIRED')
    }
    return {
      ZETTLE_PILOT_TENANT_ID: tenantId,
      ZETTLE_MERCHANT_ID: row.merchantId,
      ZETTLE_ACCESS_TOKEN: tokens.access_token,
      ZETTLE_ACCESS_EXPIRES_AT: String(expiresAt),
    }
  }
  throw new Error('PAYPAL_CONNECTION_CHANGED')
}
export async function disconnectPayPal(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('disconnect_paypal', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error) throw new Error(paypalErrorCode(r.error.message))
  return { disconnected: true }
}
export function paypalErrorCode(message: string) {
  return [
    'FORBIDDEN',
    'ZETTLE_NOT_CONNECTED',
    'ZETTLE_AUTH_REQUIRED',
    'ZETTLE_WRONG_MERCHANT',
    'ZETTLE_RATE_LIMITED',
    'ZETTLE_CONNECTION_FAILED',
    'PAYPAL_APP_UNAVAILABLE',
    'PAYPAL_APP_AUTH_FAILED',
    'PAYPAL_STATE_INVALID',
    'PAYPAL_CONNECTION_CHANGED',
    'PAYPAL_REFRESH_BUSY',
    'PAYPAL_RECONNECT_REQUIRED',
  ].includes(message)
    ? message
    : 'ZETTLE_CONNECTION_FAILED'
}
