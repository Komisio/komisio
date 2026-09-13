import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pilotAvailable,
  pilotIssue,
  verifyPilotConnection,
} from '../../extensions/zettle/auth'
import { checkZettleConnection } from '../../lib/engine/zettle-connection'
const tenant = '10000000-0000-4000-8000-000000000001',
  merchant = '20000000-0000-4000-8000-000000000001'
const env = {
  ZETTLE_PILOT_TENANT_ID: tenant,
  ZETTLE_CLIENT_ID: '30000000-0000-4000-8000-000000000001',
  ZETTLE_API_KEY: 'synthetic-only.not-a-real-key',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const ready = () =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json({
        access_token: 'synthetic-access-token',
        expires_in: '7200',
        token_type: 'Bearer',
      }),
    )
    .mockResolvedValueOnce(
      json({
        uuid: tenant,
        organizationUuid: merchant,
        email: 'discard@example.test',
      }),
    )
it('sends the assertion in a form body to the fixed official host and returns no credentials', async () => {
  const http = ready()
  const r = await verifyPilotConnection(tenant, env, http)
  expect(http.mock.calls[0][0]).toBe('https://oauth.zettle.com/token')
  expect(
    Object.fromEntries(
      new URLSearchParams(String(http.mock.calls[0][1]?.body)),
    ),
  ).toEqual({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: env.ZETTLE_CLIENT_ID,
    assertion: env.ZETTLE_API_KEY,
  })
  expect(http.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
  })
  expect(http.mock.calls[1][0]).toBe('https://oauth.zettle.com/users/self')
  expect(r).toEqual({
    organizationId: merchant,
    merchantPinned: false,
    checkedAt: expect.any(String),
  })
  expect(JSON.stringify(r)).not.toMatch(/synthetic|access_token|email/)
})
it('pins the merchant when configured', async () => {
  await expect(
    verifyPilotConnection(
      tenant,
      { ...env, ZETTLE_MERCHANT_ID: merchant },
      ready(),
    ),
  ).resolves.toMatchObject({ merchantPinned: true })
})
it('has no fallback for a different tenant', async () => {
  const http = ready()
  expect(pilotAvailable(merchant, env)).toBe(false)
  await expect(verifyPilotConnection(merchant, env, http)).rejects.toThrow(
    'ZETTLE_NOT_CONNECTED',
  )
  expect(http).not.toHaveBeenCalled()
})
it.each([
  { ZETTLE_API_KEY: '' },
  { ZETTLE_PILOT_TENANT_ID: undefined },
  { ZETTLE_CLIENT_ID: ' ' },
  { ZETTLE_CLIENT_ID: 'invalid\nclient' },
  { ZETTLE_CLIENT_ID: 'x'.repeat(4097) },
  { ZETTLE_MERCHANT_ID: 'invalid' },
])('fails closed on missing/invalid configuration %j', async (patch) => {
  const http = ready()
  await expect(
    verifyPilotConnection(tenant, { ...env, ...patch }, http),
  ).rejects.toThrow('ZETTLE_NOT_CONNECTED')
  expect(http).not.toHaveBeenCalled()
})
it('rejects a changed merchant identity', async () => {
  await expect(
    verifyPilotConnection(
      tenant,
      { ...env, ZETTLE_MERCHANT_ID: tenant },
      ready(),
    ),
  ).rejects.toThrow('ZETTLE_WRONG_MERCHANT')
})
it.each([400, 401, 403, 500])(
  'sanitizes provider errors, status %s',
  async (status) => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ error_description: env.ZETTLE_API_KEY }, status),
      )
    await expect(verifyPilotConnection(tenant, env, http)).rejects.toThrow(
      'ZETTLE_AUTH_REQUIRED',
    )
    expect(http).toHaveBeenCalledTimes(1)
  },
)
it('does not reveal transport error messages', async () => {
  const http = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error(env.ZETTLE_API_KEY))
  await expect(verifyPilotConnection(tenant, env, http)).rejects.toThrow(
    'ZETTLE_CONNECTION_FAILED',
  )
})
it('does not retry rate limits or mutate products/purchases', async () => {
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 429 }))
  await expect(verifyPilotConnection(tenant, env, http)).rejects.toThrow(
    'ZETTLE_RATE_LIMITED',
  )
  expect(http).toHaveBeenCalledTimes(1)
})
it.each([
  { access_token: 'x', expires_in: 0 },
  { access_token: 'x', expires_in: 'invalid' },
  { access_token: 'x\r\ny', expires_in: 7200 },
  { access_token: 'x', expires_in: 7200, token_type: 'Basic' },
])('rejects malformed token responses', async (body) => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(json(body))
  await expect(verifyPilotConnection(tenant, env, http)).rejects.toThrow()
  expect(http).toHaveBeenCalledTimes(1)
})
it.each(['staff', 'readonly', null])(
  'checks SQL role/MFA before credentials for role %s',
  async (role) => {
    const rpc = vi.fn().mockResolvedValue({ data: role, error: null }),
      http = ready()
    await expect(
      checkZettleConnection(
        { rpc } as unknown as SupabaseClient,
        tenant,
        env,
        http,
      ),
    ).rejects.toThrow('FORBIDDEN')
    expect(rpc).toHaveBeenCalledWith('tenant_role', { p_tenant: tenant })
    expect(http).not.toHaveBeenCalled()
  },
)
it('allows an identified owner through the engine', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: 'owner', error: null })
  await expect(
    checkZettleConnection(
      { rpc } as unknown as SupabaseClient,
      tenant,
      env,
      ready(),
    ),
  ).resolves.toMatchObject({ organizationId: merchant })
})

it('accepts an opaque client ID and trims pasted configuration consistently', async () => {
  const http = ready()
  const supplied = {
    ZETTLE_PILOT_TENANT_ID: ` ${tenant}\n`,
    ZETTLE_CLIENT_ID: ' opaque-client-id\n',
    ZETTLE_API_KEY: ` ${env.ZETTLE_API_KEY}\n`,
    ZETTLE_MERCHANT_ID: ` ${merchant}\n`,
  }
  expect(pilotAvailable(tenant, supplied)).toBe(true)
  await expect(
    verifyPilotConnection(tenant, supplied, http),
  ).resolves.toMatchObject({ merchantPinned: true })
  const form = new URLSearchParams(String(http.mock.calls[0][1]?.body))
  expect(form.get('client_id')).toBe('opaque-client-id')
  expect(form.get('assertion')).toBe(env.ZETTLE_API_KEY)
})
it('returns only safe reason codes and hides credential configuration for other stores', () => {
  expect(pilotIssue(tenant, env)).toBeNull()
  expect(pilotIssue(tenant, {})).toBe('connectionTenantMissing')
  expect(pilotIssue(tenant, { ...env, ZETTLE_CLIENT_ID: '' })).toBe(
    'connectionClientMissing',
  )
  expect(pilotIssue(tenant, { ...env, ZETTLE_API_KEY: '' })).toBe(
    'connectionKeyMissing',
  )
  expect(pilotIssue(tenant, { ...env, ZETTLE_MERCHANT_ID: 'invalid' })).toBe(
    'connectionMerchantInvalid',
  )
  for (const patch of [{}, { ZETTLE_CLIENT_ID: '' }, { ZETTLE_API_KEY: '' }]) {
    expect(pilotIssue(merchant, { ...env, ...patch })).toBe(
      'connectionUnavailable',
    )
  }
})
