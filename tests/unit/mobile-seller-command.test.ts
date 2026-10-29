import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  assurance: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
import { POST, OPTIONS } from '../../app/api/mobile/v1/seller/route'
import { mobileSellerCommand } from '../../lib/engine/mobile-seller-command'

const tenant = '71900000-0000-4000-8000-000000000001'
const seller = '71900000-0000-4000-8000-000000000002'
const requestId = '71900000-0000-4000-8000-000000000003'
const agreement = '71900000-0000-4000-8000-000000000004'
const translation = '71900000-0000-4000-8000-000000000005'
const token = 'synthetic.access.token'
const payout = {
  action: 'requestPayout',
  tenantId: tenant,
  sellerId: seller,
  requestId,
  amountOre: 10000,
}
const bank = {
  action: 'saveBank',
  tenantId: tenant,
  sellerId: seller,
  requestId,
  expected: null,
  details: {
    holder: 'Synthetic seller',
    country: 'SE',
    kind: 'local',
    account: '123456789',
    routing: '1234',
  },
}
function request(
  body: unknown = payout,
  extra: Record<string, string> = {},
  bearer = true,
) {
  return new Request('https://api.example.test/api/mobile/v1/seller', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  })
}
function preflight(
  origin = 'https://mobile.example.test',
  method = 'POST',
  headers = 'authorization, content-type',
) {
  return new Request('https://api.example.test/api/mobile/v1/seller', {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': headers,
    },
  })
}
function expectNoWrite() {
  expect(
    mocks.rpc.mock.calls.filter(([name]) => name !== 'my_seller_accounts'),
  ).toHaveLength(0)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('KOMISIO_MOBILE_API_ENABLED', 'true')
  vi.stubEnv(
    'KOMISIO_MOBILE_ALLOWED_ORIGINS',
    'https://mobile.example.test,http://127.0.0.1:8082',
  )
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-public-key')
  mocks.createClient.mockReturnValue({
    auth: {
      getUser: mocks.getUser,
      mfa: { getAuthenticatorAssuranceLevel: mocks.assurance },
    },
    rpc: mocks.rpc,
  })
  mocks.getUser.mockResolvedValue({
    data: {
      user: { id: 'user', email_confirmed_at: '2026-10-29', app_metadata: {} },
    },
    error: null,
  })
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    error: null,
  })
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'my_seller_accounts'
      ? {
          data: [
            {
              tenantId: tenant,
              sellerId: seller,
              storeName: 'Synthetic store',
            },
          ],
          error: null,
        }
      : { data: requestId, error: null },
  )
})
afterEach(() => vi.unstubAllEnvs())

describe('mobile seller authentication and scope', () => {
  it('uses only the bearer and public project key, with no session persistence', async () => {
    const response = await POST(
      request(payout, { cookie: 'other-staff-session=ignored' }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, id: requestId })
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://supabase.example.test',
      'synthetic-public-key',
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )
    expect(mocks.getUser).toHaveBeenCalledWith(token)
    expect(mocks.assurance).toHaveBeenCalledWith(token)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(mocks.rpc).toHaveBeenLastCalledWith('request_my_payout', {
      p_tenant: tenant,
      p_seller: seller,
      p_id: requestId,
      p_amount_ore: 10000,
    })
  })
  it.each([
    '',
    'Basic abc',
    'Bearer not-a-jwt',
    'Bearer a.b.c d',
    `Bearer ${'a'.repeat(16385)}.b.c`,
  ])(
    'rejects missing or malformed token %s before identity/writes',
    async (authorization) => {
      expect(
        (await POST(request(payout, { authorization }, false))).status,
      ).toBe(401)
      expect(mocks.createClient).not.toHaveBeenCalled()
      expectNoWrite()
    },
  )
  it('never falls back to a browser cookie', async () => {
    expect(
      (await POST(request(payout, { cookie: 'valid-cookie=ignored' }, false)))
        .status,
    ).toBe(401)
    expectNoWrite()
  })
  it.each([401, 403, 500])(
    'fails closed when remote token verification fails (%s)',
    async (status) => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status, message: 'Sensitive remote details' },
      })
      const response = await POST(request())
      expect(response.status).toBe(status === 500 ? 503 : 401)
      expect(await response.text()).not.toContain('Sensitive')
      expectNoWrite()
    },
  )
  it('refuses unconfirmed identity and unfinished password recovery', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: null, app_metadata: {} } },
      error: null,
    })
    expect((await POST(request())).status).toBe(401)
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          email_confirmed_at: '2026-10-29',
          app_metadata: { komisio_password_recovery_pending: true },
        },
      },
      error: null,
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'PASSWORD_UPDATE_REQUIRED' })
    expectNoWrite()
  })
  it('requires aal2 when current verified factors require it', async () => {
    mocks.assurance.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'MFA_REQUIRED' })
    expectNoWrite()
    mocks.assurance.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    })
    expect((await POST(request())).status).toBe(200)
  })
  it.each([
    { data: null, error: {} },
    { data: { currentLevel: null, nextLevel: null }, error: null },
  ])('does not proceed when assurance is unknown', async (result) => {
    mocks.assurance.mockResolvedValue(result)
    expect((await POST(request())).status).toBe(503)
    expectNoWrite()
  })
  it('rejects a foreign tenant/seller and even a duplicated account read', async () => {
    for (const rows of [
      [],
      [{ tenantId: agreement, sellerId: seller, storeName: 'Other' }],
      [{ tenantId: tenant, sellerId: agreement, storeName: 'Other' }],
      Array(2).fill({
        tenantId: tenant,
        sellerId: seller,
        storeName: 'Duplicate',
      }),
    ]) {
      mocks.rpc.mockResolvedValue({ data: rows, error: null })
      expect((await POST(request())).status).toBe(403)
      expectNoWrite()
    }
  })
  it('fails closed on an unreadable seller account list', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Secret database details' },
    })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' })
    expectNoWrite()
  })
})

describe('mobile transport boundary', () => {
  it.each(['KOMISIO_MOBILE_API_ENABLED', 'KOMISIO_INTAKE_ENABLED'])(
    'requires opt-in %s',
    async (name) => {
      vi.stubEnv(name, 'false')
      expect((await POST(request())).status).toBe(404)
      expect((await OPTIONS(preflight())).status).toBe(404)
      expectNoWrite()
    },
  )
  it('accepts an exact configured browser origin without credentialed CORS', async () => {
    const response = await POST(
      request(payout, { origin: 'https://mobile.example.test' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://mobile.example.test',
    )
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
    const options = await OPTIONS(preflight())
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS',
    )
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
  it.each([
    'null',
    'https://mobile.example.test.evil.test',
    'https://mobile.example.test:444',
    'http://mobile.example.test',
  ])('rejects unconfigured origin %s', async (origin) => {
    const response = await POST(request(payout, { origin }))
    expect(response.status).toBe(403)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expectNoWrite()
  })
  it('ignores invalid configured origins and permits explicitly listed loopback HTTP', async () => {
    vi.stubEnv(
      'KOMISIO_MOBILE_ALLOWED_ORIGINS',
      '*,null,http://mobile.example.test,https://user:pass@mobile.example.test,https://mobile.example.test/path,http://127.0.0.1:8082',
    )
    expect(
      (await POST(request(payout, { origin: 'https://mobile.example.test' })))
        .status,
    ).toBe(403)
    expect(
      (await POST(request(payout, { origin: 'http://127.0.0.1:8082' }))).status,
    ).toBe(200)
  })
  it('restricts preflight methods/headers and never authenticates preflight', async () => {
    expect(
      (await OPTIONS(preflight('https://mobile.example.test', 'DELETE')))
        .status,
    ).toBe(403)
    expect(
      (
        await OPTIONS(
          preflight(
            'https://mobile.example.test',
            'POST',
            'authorization,x-admin',
          ),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await OPTIONS(
          new Request('https://api.example.test', { method: 'OPTIONS' }),
        )
      ).status,
    ).toBe(403)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expectNoWrite()
  })
  it('rejects malformed/oversized JSON before authentication, including false content length', async () => {
    for (const [body, status] of [
      ['{', 400],
      ['"' + '🌿'.repeat(3000) + '"', 413],
    ] as const) {
      const response = await POST(
        new Request('https://api.example.test', {
          method: 'POST',
          body,
          headers: {
            'content-type': 'application/json',
            'content-length': '2',
          },
        }),
      )
      expect(response.status).toBe(status)
    }
    expect(
      (
        await POST(
          new Request('https://api.example.test', {
            method: 'POST',
            body: '{}',
            headers: { 'content-type': 'text/plain' },
          }),
        )
      ).status,
    ).toBe(415)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expectNoWrite()
  })
})

describe('mobile engine dispatch and replay contract', () => {
  it('reuses strict existing schemas and excludes staff operations/unknown metadata', async () => {
    for (const value of [
      { ...bank, action: 'review' },
      { ...payout, action: 'notifications', enabled: true },
      { ...payout, staff: true },
      { ...payout, amountOre: 1.5 },
      { ...payout, amountOre: 0 },
    ]) {
      expect(mobileSellerCommand.safeParse(value).success).toBe(false)
      expect((await POST(request(value))).status).toBe(400)
    }
    expectNoWrite()
  })
  it('saves bank details with the exact expected version and request ID', async () => {
    const command = { ...bank, expected: agreement }
    expect((await POST(request(command))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith('save_seller_bank_details', {
      p_tenant: tenant,
      p_seller: seller,
      p_id: requestId,
      p_expected: agreement,
      p_details: bank.details,
    })
  })
  it('pins agreement and translation and accepts an existing equivalent evidence ID', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'my_seller_accounts'
        ? {
            data: [{ tenantId: tenant, sellerId: seller, storeName: 'Store' }],
            error: null,
          }
        : { data: agreement, error: null },
    )
    const response = await POST(
      request({
        action: 'acceptAgreement',
        tenantId: tenant,
        sellerId: seller,
        requestId,
        agreementId: agreement,
        translationId: translation,
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, id: agreement })
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'accept_my_seller_agreement_text',
      {
        p_tenant: tenant,
        p_seller: seller,
        p_id: requestId,
        p_agreement: agreement,
        p_translation: translation,
      },
    )
  })
  it.each([
    'PAYOUT_BELOW_THRESHOLD',
    'PAYOUT_EXCEEDS_BALANCE',
    'REQUEST_CONFLICT',
    'SELLER_CLOSED',
  ])('returns a safe deterministic failure %s', async (message) => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'my_seller_accounts'
        ? {
            data: [{ tenantId: tenant, sellerId: seller, storeName: 'Store' }],
            error: null,
          }
        : { data: null, error: { message } },
    )
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: message })
  })
  it('returns unknown outcome for unexpected errors and preserves IDs across retries', async () => {
    let attempts = 0
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'my_seller_accounts'
        ? {
            data: [{ tenantId: tenant, sellerId: seller, storeName: 'Store' }],
            error: null,
          }
        : ++attempts === 1
          ? {
              data: null,
              error: { message: 'sensitive account 1234 database error' },
            }
          : { data: requestId, error: null },
    )
    const first = await POST(request())
    expect(first.status).toBe(503)
    expect(await first.json()).toEqual({ error: 'REQUEST_FAILED' })
    expect((await POST(request())).status).toBe(200)
    const writes = mocks.rpc.mock.calls.filter(
      ([name]) => name === 'request_my_payout',
    )
    expect(writes[0][1]).toEqual(writes[1][1])
  })
  it('does not report success for a malformed or mismatched payout result', async () => {
    for (const result of [null, 'invalid', agreement]) {
      mocks.rpc.mockImplementation(async (name: string) =>
        name === 'my_seller_accounts'
          ? {
              data: [
                { tenantId: tenant, sellerId: seller, storeName: 'Store' },
              ],
              error: null,
            }
          : { data: result, error: null },
      )
      expect((await POST(request())).status).toBe(503)
    }
  })
})
