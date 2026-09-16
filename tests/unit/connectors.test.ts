import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authorizeRequest,
  connectorClient,
  connectorScopes,
  connectorsEnabled,
  deniedRedirect,
  issueTokens,
  oauthMetadata,
  pkceChallenge,
  protectedResourceMetadata,
  registerClient,
  requestedScopes,
  sha256Hex,
  tokenRequest,
} from '../../lib/engine/connectors'
import { safeNext } from '../../lib/platform/validation'
import {
  hostedExcludedTools,
  hostedToolAllowed,
  mcpConfig,
} from '../../mcp/config'

describe('hosted MCP connector', () => {
  it('computes the RFC 7636 S256 challenge', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
  it('publishes itself as authorization server and resource', () => {
    const meta = oauthMetadata('https://app.example.test')
    expect(meta.issuer).toBe('https://app.example.test')
    expect(meta.token_endpoint).toBe('https://app.example.test/api/oauth/token')
    expect(meta.code_challenge_methods_supported).toEqual(['S256'])
    expect(meta.token_endpoint_auth_methods_supported).toEqual(['none'])
    const resource = protectedResourceMetadata('https://app.example.test')
    expect(resource.resource).toBe('https://app.example.test/api/mcp')
    expect(resource.authorization_servers).toEqual(['https://app.example.test'])
    expect(resource.scopes_supported).not.toContain('reception:photos')
    expect(connectorScopes).toHaveLength(19)
  })
  it('lets login return to the consent page and nowhere else new', () => {
    expect(
      safeNext(
        '/oauth/authorize?response_type=code&client_id=x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb',
      ),
    ).toBe(
      '/oauth/authorize?response_type=code&client_id=x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb',
    )
    expect(safeNext('/oauth/authorize')).toBe('/')
    expect(safeNext('/oauth/authorize?<script>')).toBe('/')
    expect(safeNext('//evil.example/oauth/authorize?x=1')).toBe('/')
  })
  it('is off unless enabled with a public URL', () => {
    expect(connectorsEnabled({})).toBe(false)
    expect(connectorsEnabled({ KOMISIO_CONNECTORS_ENABLED: 'true' })).toBe(
      false,
    )
    expect(
      connectorsEnabled({
        KOMISIO_CONNECTORS_ENABLED: 'true',
        NEXT_PUBLIC_APP_URL: 'https://app.example.test',
      }),
    ).toBe(true)
  })
  it('parses the authorization request and offers every scope when none is named', () => {
    const ok = authorizeRequest.safeParse({
      response_type: 'code',
      client_id: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'xyz',
    })
    expect(ok.success).toBe(true)
    expect(
      authorizeRequest.safeParse({
        response_type: 'token',
        client_id: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab',
        redirect_uri: 'https://claude.ai/cb',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'plain',
      }).success,
    ).toBe(false)
    expect(requestedScopes(undefined)).toEqual([...connectorScopes])
    expect(
      requestedScopes('items:read economy:read reception:photos bogus'),
    ).toEqual(['items:read', 'economy:read'])
    expect(deniedRedirect('https://claude.ai/cb?x=1', 's')).toBe(
      'https://claude.ai/cb?x=1&error=access_denied&state=s',
    )
  })
  it('registers a public client and maps the stored shape to RFC 7591', async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe('register_connector_client')
      return {
        data: {
          clientId: args.p_id,
          name: args.p_name,
          redirectUris: args.p_redirect_uris,
        },
        error: null,
      }
    })
    const out = await registerClient({ rpc } as unknown as SupabaseClient, {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code'],
    })
    expect(out.client_name).toBe('Claude')
    expect(out.token_endpoint_auth_method).toBe('none')
    expect(out.client_id).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('hands SQL only hashes and voids a replayed code', async () => {
    const calls: [string, Record<string, unknown>][] = []
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args])
      if (fn === 'exchange_connector_code')
        return calls.length === 1
          ? {
              data: {
                grantId: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab',
                tenantId: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ac',
                userId: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ad',
                clientId: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ae',
                scopes: ['items:read'],
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                clientName: 'Claude',
              },
              error: null,
            }
          : { data: null, error: { message: 'CONNECTOR_CODE_REUSED' } }
      return { data: null, error: null }
    })
    const client = { rpc } as unknown as SupabaseClient
    const request = {
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      client_id: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ae',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    }
    expect(tokenRequest.safeParse(request).success).toBe(true)
    const tokens = await issueTokens(client, request)
    expect(tokens.token_type).toBe('Bearer')
    expect(tokens.scope).toBe('items:read')
    expect(tokens.expires_in).toBeGreaterThan(3500)
    const first = calls[0][1]
    expect(first.p_code_hash).toBe(sha256Hex('the-code'))
    expect(first.p_code_challenge).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    expect(first.p_access_hash).toBe(sha256Hex(tokens.access_token))
    expect(first.p_refresh_hash).toBe(sha256Hex(tokens.refresh_token))
    expect(JSON.stringify(calls)).not.toContain(tokens.access_token)
    await expect(issueTokens(client, request)).rejects.toThrow(
      'CONNECTOR_CODE_REUSED',
    )
    expect(calls.at(-1)).toEqual([
      'void_connector_secret',
      { p_hash: sha256Hex('the-code') },
    ])
  })
  it('routes every rpc of the tools through connector_call and refuses table access', async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe('connector_call')
      expect(args.p_access_hash).toBe(sha256Hex('token-1'))
      return args.p_function === 'tenant_role'
        ? { data: 'owner', error: null, status: 200, statusText: 'OK' }
        : {
            data: null,
            error: { message: 'SCOPE_REQUIRED', code: 'P0001' },
            status: 400,
            statusText: 'Bad Request',
          }
    })
    const wrapped = connectorClient(
      { rpc } as unknown as SupabaseClient,
      'token-1',
    )
    const role = await wrapped.rpc('tenant_role', { p_tenant: 'x' })
    expect(role.data).toBe('owner')
    expect(rpc.mock.calls[0][1]).toEqual({
      p_access_hash: sha256Hex('token-1'),
      p_function: 'tenant_role',
      p_args: { p_tenant: 'x' },
    })
    const refused = await wrapped.rpc('accept_item', {})
    expect(refused.error?.message).toBe('SCOPE_REQUIRED')
    expect(() => wrapped.from('items')).toThrow('NOT_AVAILABLE')
  })
  it('accepts a hosted configuration without a token and keeps table-reading tools local', () => {
    const hosted = mcpConfig.parse({
      url: 'https://x.supabase.co',
      key: 'k',
      tenantId: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab',
      userId: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ad',
      hosted: true,
      scopes: [...connectorScopes],
    })
    expect(hosted.hosted).toBe(true)
    expect(hostedToolAllowed('komisio_find_items')).toBe(true)
    expect(hostedToolAllowed('komisio_read_receipt')).toBe(false)
    expect(hostedExcludedTools.size).toBe(18)
  })
})
