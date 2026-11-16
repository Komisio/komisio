import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  serverClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../../lib/supabase/server', () => ({ serverClient: m.serverClient }))
import { POST } from '../../app/api/host/account-deletion/route'
const id = 'f6870000-0000-4000-8000-000000000001'
function request(origin = 'https://portal.example.test') {
  return new Request(`${origin}/api/host/account-deletion`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'processing',
      requestId: id,
      eventId: 'f6870000-0000-4000-8000-000000000002',
      expected: null,
      evidence: {},
    }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.example.test')
  m.serverClient.mockResolvedValue({ auth: { getUser: m.getUser }, rpc: m.rpc })
  m.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
  m.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } })
})
afterEach(() => vi.unstubAllEnvs())
it.each([null, { message: 'Session expired' }])(
  'returns an authentication error for a missing or expired host session',
  async (error) => {
    m.getUser.mockResolvedValue({ data: { user: null }, error })
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(m.rpc).not.toHaveBeenCalled()
  },
)
it('rejects cross-origin requests before reading the session', async () => {
  expect((await POST(request('https://untrusted.example.test'))).status).toBe(
    403,
  )
  expect(m.serverClient).not.toHaveBeenCalled()
  expect(m.rpc).not.toHaveBeenCalled()
})
it('keeps the database host authorization authoritative after authentication', async () => {
  const response = await POST(request())
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: 'FORBIDDEN' })
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('handle_account_deletion', {
    p_id: 'f6870000-0000-4000-8000-000000000002',
    p_request: id,
    p_expected: null,
    p_kind: 'processing',
    p_evidence: {},
  })
})
