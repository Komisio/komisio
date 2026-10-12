import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  startPayPalConnection,
  completePayPalConnection,
  paypalEnvironment,
  paypalAppAvailable,
} from '../../lib/engine/paypal-credentials'
import { open, seal } from '../../lib/platform/credentials'
import {
  paypalTokenRequest,
  PAYPAL_SCOPES,
} from '../../extensions/zettle/oauth'
const tenant = 'f1460000-0000-4000-8000-000000000001',
  other = 'f1460000-0000-4000-8000-000000000002',
  merchant = 'f1460000-0000-4000-8000-000000000010'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  PAYPAL_POS_CLIENT_ID: 'shared-public-client',
  PAYPAL_POS_CLIENT_SECRET: 'synthetic-partner-secret',
}
const tokens = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_in: 7200,
}
const uri = 'https://example.test/api/integrations/paypal/callback'
function fixture(role = 'owner') {
  const status = {
    connected: false,
    merchantId: null as string | null,
    revision: '0',
    reconnectRequired: false,
  }
  const rpc = vi.fn(
    async (
      name: string,
      args?: unknown,
    ): Promise<{ data: unknown; error: null | { message: string } }> => ({
      data:
        name === 'tenant_role'
          ? (void args, role)
          : name === 'paypal_connection_status'
            ? status
            : null,
      error: null,
    }),
  )
  const client = {
    rpc,
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: other } }, error: null }),
    },
  } as unknown as SupabaseClient
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(tokens))
    .mockResolvedValueOnce(Response.json({ organizationUuid: merchant }))
  return { client, rpc, http, status }
}
async function start(f: ReturnType<typeof fixture>) {
  const result = await startPayPalConnection(f.client, tenant, other, uri, env)
  return { ...result, state: new URL(result.url).searchParams.get('state')! }
}
describe('PayPal partner OAuth', () => {
  it('uses partner code grant and binds state and redirect URI to the browser cookie', async () => {
    const f = fixture(),
      a = await start(f),
      b = await start(f),
      url = new URL(a.url)
    expect(url.origin).toBe('https://oauth.zettle.com')
    expect(url.searchParams.get('scope')).toBe(PAYPAL_SCOPES)
    expect(a.state).not.toBe(b.state)
    const cookie = open(
      'paypal-oauth-state',
      JSON.parse(Buffer.from(a.cookie, 'base64url').toString()),
      env,
    ) as { state: string; redirectUri: string }
    expect(cookie).toEqual({ state: a.state, redirectUri: uri })
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(uri)
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('code_challenge_method')).toBe(false)
    expect(a.url).not.toContain(env.PAYPAL_POS_CLIENT_SECRET)
    expect(JSON.stringify(cookie)).not.toContain(env.PAYPAL_POS_CLIENT_SECRET)
  })
  it('verifies the merchant before persisting tenant-sealed tokens; does not enable synchronization', async () => {
    const f = fixture(),
      a = await start(f)
    await expect(
      completePayPalConnection(
        f.client,
        tenant,
        other,
        { code: 'code', state: a.state, cookie: a.cookie },
        env,
        f.http,
      ),
    ).resolves.toEqual({ organizationId: merchant })
    const saved = f.rpc.mock.calls.find(
      (c) => c[0] === 'store_paypal_oauth',
    )![1] as { p_cipher: unknown }
    expect(open(`paypal-oauth:${tenant}`, saved.p_cipher, env)).toEqual(tokens)
    expect(JSON.stringify(saved)).not.toContain(tokens.refresh_token)
    expect(f.rpc.mock.calls.some((c) => c[0] === 'enable_zettle_pull')).toBe(
      false,
    )
    const body = new URLSearchParams(String(f.http.mock.calls[0][1]?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe(env.PAYPAL_POS_CLIENT_ID)
    expect(body.get('client_secret')).toBe(env.PAYPAL_POS_CLIENT_SECRET)
    expect(body.get('redirect_uri')).toBe(uri)
    expect(body.has('code_verifier')).toBe(false)
  })
  it.each(['staff', 'readonly'])('denies connection for %s', async (role) => {
    const f = fixture(role)
    await expect(start(f)).rejects.toThrow('FORBIDDEN')
    expect(f.http).not.toHaveBeenCalled()
  })
  it('requires the shared server secret before starting authorization', async () => {
    const f = fixture()
    const source = { ...env, PAYPAL_POS_CLIENT_SECRET: '' }
    expect(paypalAppAvailable(source)).toBe(false)
    expect(paypalAppAvailable(env)).toBe(true)
    await expect(
      startPayPalConnection(f.client, tenant, other, uri, source),
    ).rejects.toThrow('PAYPAL_APP_UNAVAILABLE')
    expect(f.http).not.toHaveBeenCalled()
  })
  it.each(['cookie', 'state', 'tenant', 'user', 'expired', 'revision'])(
    'refuses changed %s before exchanging code',
    async (change) => {
      const f = fixture(),
        a = await start(f)
      if (change === 'revision') f.status.revision = '2'
      if (change === 'expired') {
        vi.useFakeTimers()
        vi.advanceTimersByTime(601000)
      }
      try {
        await expect(
          completePayPalConnection(
            f.client,
            change === 'tenant' ? other : tenant,
            change === 'user' ? tenant : other,
            {
              code: 'code',
              state: change === 'state' ? a.state + 'x' : a.state,
              cookie: change === 'cookie' ? (await start(f)).cookie : a.cookie,
            },
            env,
            f.http,
          ),
        ).rejects.toThrow()
        expect(f.http).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    },
  )
  it('refuses a different merchant before storage', async () => {
    const f = fixture()
    f.status.merchantId = other
    const a = await start(f)
    await expect(
      completePayPalConnection(
        f.client,
        tenant,
        other,
        { code: 'code', state: a.state, cookie: a.cookie },
        env,
        f.http,
      ),
    ).rejects.toThrow('ZETTLE_WRONG_MERCHANT')
    expect(f.rpc.mock.calls.some((c) => c[0] === 'store_paypal_oauth')).toBe(
      false,
    )
  })
  it('does not fall back to obsolete deployment credentials', async () => {
    const f = fixture()
    expect(
      await paypalEnvironment(f.client, tenant, {
        ...env,
        ZETTLE_API_KEY: 'retired',
        ZETTLE_PILOT_TENANT_ID: tenant,
      }),
    ).toEqual({})
  })
  it('rejects copied ciphertext and database denial before HTTP', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({
      data: {
        merchantId: merchant,
        revision: '1',
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        cipher: seal(`paypal-oauth:${other}`, tokens, env),
      },
      error: null,
    })
    await expect(
      paypalEnvironment(f.client, tenant, env, f.http),
    ).rejects.toThrow('CREDENTIAL_UNREADABLE')
    expect(f.http).not.toHaveBeenCalled()
    f.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } })
    await expect(
      paypalEnvironment(f.client, tenant, env, f.http),
    ).rejects.toThrow('FORBIDDEN')
  })
  it.each(['busy', 'unknown', 'claimed'])(
    'handles refresh claim %s without duplicate token requests',
    async (status) => {
      const f = fixture(),
        row = {
          merchantId: merchant,
          revision: '1',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          cipher: seal(`paypal-oauth:${tenant}`, tokens, env),
        }
      f.rpc.mockImplementation(async (name) => ({
        data:
          name === 'read_paypal_credentials'
            ? row
            : name === 'claim_paypal_refresh'
              ? { status }
              : null,
        error: null,
      }))
      if (status === 'claimed') {
        const result = await paypalEnvironment(f.client, tenant, env, f.http)
        expect(result.ZETTLE_ACCESS_TOKEN).toBe(tokens.access_token)
        expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
          'read_paypal_credentials',
          'claim_paypal_refresh',
          'finish_paypal_refresh',
        ])
        expect(
          new URLSearchParams(String(f.http.mock.calls[0][1]?.body)).get(
            'grant_type',
          ),
        ).toBe('refresh_token')
        expect(
          new URLSearchParams(String(f.http.mock.calls[0][1]?.body)).get(
            'client_secret',
          ),
        ).toBe(env.PAYPAL_POS_CLIENT_SECRET)
      } else {
        await expect(
          paypalEnvironment(f.client, tenant, env, f.http),
        ).rejects.toThrow(
          status === 'busy'
            ? 'PAYPAL_REFRESH_BUSY'
            : 'PAYPAL_RECONNECT_REQUIRED',
        )
        expect(f.http).not.toHaveBeenCalled()
      }
    },
  )
  it('does not use a rotated token if persistence fails', async () => {
    const f = fixture()
    f.rpc.mockImplementation(async (name) => ({
      data:
        name === 'read_paypal_credentials'
          ? {
              merchantId: merchant,
              revision: '1',
              expiresAt: new Date(0).toISOString(),
              cipher: seal(`paypal-oauth:${tenant}`, tokens, env),
            }
          : name === 'claim_paypal_refresh'
            ? { status: 'claimed' }
            : null,
      error: name === 'finish_paypal_refresh' ? { message: 'lost' } : null,
    }))
    await expect(
      paypalEnvironment(f.client, tenant, env, f.http),
    ).rejects.toThrow('PAYPAL_RECONNECT_REQUIRED')
  })
  it('does not claim a refresh token when the server secret is missing', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({
      data: {
        merchantId: merchant,
        revision: '1',
        expiresAt: new Date(0).toISOString(),
        cipher: seal(`paypal-oauth:${tenant}`, tokens, env),
      },
      error: null,
    })
    await expect(
      paypalEnvironment(
        f.client,
        tenant,
        {
          ...env,
          PAYPAL_POS_CLIENT_SECRET: '',
        },
        f.http,
      ),
    ).rejects.toThrow('PAYPAL_APP_UNAVAILABLE')
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
      'read_paypal_credentials',
    ])
    expect(f.http).not.toHaveBeenCalled()
  })
  it.each(['invalid_client', 'unauthorized_client'])(
    'reports %s without exposing provider details',
    async (error) => {
      const http = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error,
            error_description: 'private credential details',
          },
          { status: 401 },
        ),
      )
      await expect(
        paypalTokenRequest({ code: 'private' }, http),
      ).rejects.toThrow(/^PAYPAL_APP_AUTH_FAILED$/)
    },
  )
  it('sanitizes token errors and rejects missing refresh token or insufficient scopes', async () => {
    for (const response of [
      new Response('private', { status: 400 }),
      Response.json({ access_token: 'x', expires_in: 7200 }),
      Response.json({ ...tokens, scope: 'READ:PURCHASE' }),
    ]) {
      const http = vi.fn<typeof fetch>().mockResolvedValue(response)
      await expect(
        paypalTokenRequest({ code: 'private' }, http),
      ).rejects.toThrow(/^ZETTLE_/)
    }
  })
})
