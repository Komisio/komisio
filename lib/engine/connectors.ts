import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Hosted MCP connector: Komisio is the OAuth 2.1 authorization server for
// its own MCP endpoint. An assistant registers as a public client, a member
// approves it for one store and a set of scopes on the consent page, and the
// assistant then calls the endpoint with a short-lived bearer token. The
// token is an opaque secret whose SHA-256 hash the database holds; it is
// never a Supabase session and never a service key. Every tool call becomes
// one `connector_call` in SQL, which binds the store, checks the scope of the
// exact function (and operation kind) and runs the engine function as the
// person who approved the grant. See docs/HOSTED-MCP.md.

export const connectorScopes = [
  'reception:read',
  'reception:preview',
  'reception:propose',
  'inspection:read',
  'inspection:preview',
  'inspection:propose',
  'items:read',
  'items:propose',
  'economy:read',
  'sales:read',
  'sales:propose',
  'ledger:propose',
  'lifecycle:propose',
  'communications:propose',
  'payouts:propose',
  'accounting:read',
  'accounting:propose',
  'store:read',
  'store:propose',
] as const
export type ConnectorScope = (typeof connectorScopes)[number]
const scopeSchema = z.enum(connectorScopes)

export function connectorsEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.KOMISIO_CONNECTORS_ENABLED === 'true' &&
    /^https?:\/\//.test(env.NEXT_PUBLIC_APP_URL ?? '')
  )
}
/** The issuer and resource origin: the application's own public URL. */
export function appOrigin(
  env: Record<string, string | undefined> = process.env,
) {
  return new URL(env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000').origin
}
export const mcpPath = '/api/mcp'

export function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
export function randomSecret() {
  return randomBytes(32).toString('base64url')
}
/** RFC 7636 S256: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}
const verifierShape = /^[A-Za-z0-9._~-]{43,128}$/

/** A client bound to no session: the token and registration endpoints and the MCP endpoint use it with the publishable key only. */
export function anonClient(
  env: Record<string, string | undefined> = process.env,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL,
    key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED')
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

/** RFC 8414 metadata for the authorization server Komisio itself is. */
export function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...connectorScopes],
  }
}
/** RFC 9728 metadata for the MCP endpoint as a protected resource. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${mcpPath}`,
    authorization_servers: [origin],
    scopes_supported: [...connectorScopes],
    bearer_methods_supported: ['header'],
    resource_name: 'Komisio',
  }
}

// Registration (RFC 7591): public clients, no secret. Unknown fields are ignored.
export const clientRegistration = z.object({
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
})
export const connectorClientShape = z.object({
  clientId: z.uuid(),
  name: z.string(),
  redirectUris: z.array(z.string()),
})
export async function registerClient(client: SupabaseClient, input: unknown) {
  const c = clientRegistration.parse(input)
  const r = await client.rpc('register_connector_client', {
    p_id: randomUUID(),
    p_name: c.client_name,
    p_redirect_uris: c.redirect_uris,
  })
  if (r.error) throw new Error(connectorErrorCode(r.error.message))
  const stored = connectorClientShape.parse(r.data)
  return {
    client_id: stored.clientId,
    client_name: stored.name,
    redirect_uris: stored.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }
}
export async function readClient(client: SupabaseClient, clientId: string) {
  const r = await client.rpc('connector_client', {
    p_client: z.uuid().parse(clientId),
  })
  if (r.error || r.data === null) return null
  return connectorClientShape.parse(r.data)
}

// The authorization request as the consent page receives it.
export const authorizeRequest = z.object({
  response_type: z.literal('code'),
  client_id: z.uuid(),
  redirect_uri: z.string().max(2000),
  scope: z.string().max(1000).optional(),
  state: z.string().max(1024).optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  resource: z.string().max(2000).optional(),
})
/** Requested scopes as a valid list; nothing requested means every hosted scope is offered. */
export function requestedScopes(scope: string | undefined): ConnectorScope[] {
  const named = (scope ?? '')
    .split(/[\s,]+/)
    .filter((s) => scopeSchema.safeParse(s).success) as ConnectorScope[]
  const unique = [...new Set(named)]
  return unique.length > 0 ? unique : [...connectorScopes]
}
export const consentDecision = z.strictObject({
  tenantId: z.uuid(),
  clientId: z.uuid(),
  redirectUri: z.string().max(2000),
  scopes: z.array(scopeSchema).min(1).max(20),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  state: z.string().max(1024).optional(),
})
/** The member approves: SQL records the grant and the hash of a one-time code; the code itself goes back to the client once. */
export async function authorizeConnector(
  client: SupabaseClient,
  input: unknown,
  aal: 'aal1' | 'aal2',
) {
  const c = consentDecision.parse(input)
  const code = randomSecret()
  const r = await client.rpc('authorize_connector', {
    p_id: randomUUID(),
    p_tenant: c.tenantId,
    p_client: c.clientId,
    p_redirect_uri: c.redirectUri,
    p_scopes: [...new Set(c.scopes)],
    p_code_challenge: c.codeChallenge,
    p_code_hash: sha256Hex(code),
    p_aal: aal,
  })
  if (r.error) throw new Error(connectorErrorCode(r.error.message))
  const target = new URL(c.redirectUri)
  target.searchParams.set('code', code)
  if (c.state !== undefined) target.searchParams.set('state', c.state)
  return { redirect: target.toString() }
}
export function deniedRedirect(redirectUri: string, state?: string) {
  const target = new URL(redirectUri)
  target.searchParams.set('error', 'access_denied')
  if (state !== undefined) target.searchParams.set('state', state)
  return target.toString()
}

// The token endpoint.
const tokenState = z.object({
  grantId: z.uuid(),
  tenantId: z.uuid(),
  userId: z.uuid(),
  clientId: z.uuid(),
  scopes: z.array(scopeSchema),
  expiresAt: z.string(),
  clientName: z.string(),
})
export type TokenInfo = z.infer<typeof tokenState>
export const tokenRequest = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1).max(200),
    code_verifier: z.string().regex(verifierShape),
    client_id: z.uuid(),
    redirect_uri: z.string().max(2000),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1).max(200),
    client_id: z.uuid(),
  }),
])
function tokenResponse(state: TokenInfo, access: string, refresh: string) {
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.max(
      1,
      Math.floor((Date.parse(state.expiresAt) - Date.now()) / 1000),
    ),
    refresh_token: refresh,
    scope: state.scopes.join(' '),
  }
}
/**
 * Code or refresh token in, token pair out. A replayed code or refresh token
 * voids the grant: the leak is the signal, and a raise inside SQL would undo
 * the update, so the endpoint calls the voiding function itself.
 */
export async function issueTokens(client: SupabaseClient, input: unknown) {
  const req = tokenRequest.parse(input)
  const access = randomSecret(),
    refresh = randomSecret()
  const r =
    req.grant_type === 'authorization_code'
      ? await client.rpc('exchange_connector_code', {
          p_code_hash: sha256Hex(req.code),
          p_client: req.client_id,
          p_redirect_uri: req.redirect_uri,
          p_code_challenge: pkceChallenge(req.code_verifier),
          p_access_hash: sha256Hex(access),
          p_refresh_hash: sha256Hex(refresh),
        })
      : await client.rpc('refresh_connector_token', {
          p_refresh_hash: sha256Hex(req.refresh_token),
          p_client: req.client_id,
          p_access_hash: sha256Hex(access),
          p_new_refresh_hash: sha256Hex(refresh),
        })
  if (r.error) {
    const code = connectorErrorCode(r.error.message)
    if (code === 'CONNECTOR_CODE_REUSED' || code === 'CONNECTOR_TOKEN_REUSED')
      await client.rpc('void_connector_secret', {
        p_hash: sha256Hex(
          req.grant_type === 'authorization_code'
            ? req.code
            : req.refresh_token,
        ),
      })
    throw new Error(code)
  }
  return tokenResponse(tokenState.parse(r.data), access, refresh)
}
/** Who holds this access token, or null when it is unknown, expired or revoked. */
export async function readTokenInfo(
  client: SupabaseClient,
  accessToken: string,
): Promise<{ info: TokenInfo } | { error: string }> {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(accessToken))
    return { error: 'CONNECTOR_TOKEN_INVALID' }
  const r = await client.rpc('connector_token_info', {
    p_access_hash: sha256Hex(accessToken),
  })
  if (r.error) return { error: connectorErrorCode(r.error.message) }
  const parsed = tokenState.safeParse(r.data)
  return parsed.success
    ? { info: parsed.data }
    : { error: 'CONNECTOR_TOKEN_INVALID' }
}

/**
 * The client the hosted MCP tools use: every `rpc` becomes one connector_call
 * with the same function name and arguments, so the engine code is unchanged.
 * Table and storage access are not available through a connector; the tools
 * that need them are not registered for hosted grants (see mcp/config.ts).
 */
export function connectorClient(
  base: SupabaseClient,
  accessToken: string,
): SupabaseClient {
  const hash = sha256Hex(accessToken)
  const unavailable = () => {
    throw new Error('NOT_AVAILABLE')
  }
  const wrapper = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const call = base.rpc('connector_call', {
        p_access_hash: hash,
        p_function: fn,
        p_args: args,
      })
      const mapped = call.then((r) =>
        r.error
          ? {
              data: null,
              error: r.error,
              count: null,
              status: r.status,
              statusText: r.statusText,
            }
          : {
              data: r.data,
              error: null,
              count: null,
              status: r.status,
              statusText: r.statusText,
            },
      )
      return mapped
    },
    from: unavailable,
    storage: { from: unavailable },
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: 'NOT_AVAILABLE' },
      }),
    },
  }
  return wrapper as unknown as SupabaseClient
}

// What members see under Settings.
export const connectorGrant = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  userId: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string(),
  userName: z.string().nullable(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  calls: z.number().int(),
})
export type ConnectorGrant = z.infer<typeof connectorGrant>
export async function readConnectors(client: SupabaseClient, tenant: string) {
  const r = await client.rpc('connectors', { p_tenant: z.uuid().parse(tenant) })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return z.array(connectorGrant).parse(r.data)
}
export async function revokeConnector(
  client: SupabaseClient,
  tenant: string,
  grantId: string,
) {
  const r = await client.rpc('revoke_connector', {
    p_tenant: z.uuid().parse(tenant),
    p_grant: z.uuid().parse(grantId),
  })
  if (r.error) throw new Error(connectorErrorCode(r.error.message))
  return connectorGrant.parse(r.data)
}

export const connectorErrorCodes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'RATE_LIMITED',
  'NOT_FOUND',
  'PLAN_PLUS_REQUIRED',
  'CONNECTOR_CODE_INVALID',
  'CONNECTOR_CODE_REUSED',
  'CONNECTOR_TOKEN_INVALID',
  'CONNECTOR_TOKEN_REUSED',
  'CONNECTOR_REVOKED',
  'SCOPE_REQUIRED',
  'CONNECTOR_RATE_LIMIT',
] as const
export function connectorErrorCode(message: string) {
  return (
    connectorErrorCodes.find((c) => message.includes(c)) ?? 'REQUEST_FAILED'
  )
}
