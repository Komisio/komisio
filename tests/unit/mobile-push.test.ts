import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  assurance: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
import { POST } from '../../app/api/mobile/v1/push/route'
const deviceId = 'f0000000-0000-4000-8000-000000000767'
const input = { action: 'state', deviceId, deviceSecret: 'a'.repeat(64) }
function request(body: unknown = input, authorization = true, origin?: string) {
  return new Request('https://api.example.test/api/mobile/v1/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization
        ? { Authorization: 'Bearer synthetic.access.token' }
        : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ['KOMISIO_INTAKE_ENABLED', 'KOMISIO_MOBILE_API_ENABLED'])
    vi.stubEnv(key, 'true')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic')
  mocks.createClient.mockReturnValue({
    auth: {
      getUser: mocks.getUser,
      mfa: { getAuthenticatorAssuranceLevel: mocks.assurance },
    },
    rpc: mocks.rpc,
  })
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: deviceId,
        email_confirmed_at: '2026-11-05',
        app_metadata: {},
      },
    },
    error: null,
  })
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    error: null,
  })
  mocks.rpc.mockResolvedValue({
    data: { revision: 0, enabled: false, requestId: null },
    error: null,
  })
})
afterEach(() => vi.unstubAllEnvs())
it('derives identity from bearer authentication and returns uncached device state', async () => {
  const r = await POST(request())
  expect(r.status).toBe(200)
  expect(r.headers.get('cache-control')).toContain('no-store')
  expect(await r.json()).toEqual({
    ok: true,
    revision: 0,
    enabled: false,
    requestId: null,
  })
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('my_push_device', {
    p_device: deviceId,
    p_secret: input.deviceSecret,
  })
})
it.each([
  request(input, false),
  request({ ...input, userId: deviceId }),
  request(input, true, 'https://untrusted.test'),
])(
  'rejects missing bearer, client identity and untrusted origins before RPC',
  async (req) => {
    expect((await POST(req)).status).toBeGreaterThanOrEqual(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  },
)
it('requires completed MFA and hides raw backend errors', async () => {
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal2' },
    error: null,
  })
  expect((await POST(request())).status).toBe(403)
  expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    error: null,
  })
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: 'private token details' },
  })
  expect(await (await POST(request())).json()).toEqual({
    error: 'REQUEST_FAILED',
  })
})
