import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  assurance: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: m.createClient }))
import { POST, OPTIONS } from '../../app/api/mobile/v1/account-deletion/route'
import {
  executeDeletion,
  handleDeletionCommand,
} from '../../lib/engine/account-deletion'
const id = 'f6870000-0000-4000-8000-000000000001'
const receipt = {
  id,
  status: 'requested',
  createdAt: '2026-11-16T12:00:00+00:00',
  updatedAt: '2026-11-16T12:00:00+00:00',
  respondBy: '2026-12-16T12:00:00+00:00',
  revision: null,
}
function req(
  body: unknown = { action: 'state' },
  headers: Record<string, string> = {},
) {
  return new Request(
    'https://api.example.test/api/mobile/v1/account-deletion',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer synthetic.access.token',
        ...headers,
      },
      body: JSON.stringify(body),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic')
  vi.stubEnv('KOMISIO_MOBILE_ALLOWED_ORIGINS', 'https://app.example.test')
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'false')
  m.createClient.mockReturnValue({
    auth: {
      getUser: m.getUser,
      mfa: { getAuthenticatorAssuranceLevel: m.assurance },
    },
    rpc: m.rpc,
  })
  m.getUser.mockResolvedValue({
    data: { user: { id, app_metadata: {} } },
    error: null,
  })
  m.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    error: null,
  })
  m.rpc.mockResolvedValue({ data: receipt, error: null })
})
afterEach(() => vi.unstubAllEnvs())
it('offers self deletion without store, extra verification or intake feature gates', async () => {
  const response = await POST(
    req({ action: 'request', requestId: id, locale: 'sv', confirmed: true }),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(await response.json()).toEqual({ request: receipt })
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('request_account_deletion', {
    p_id: id,
    p_locale: 'sv',
    p_confirm: true,
  })
})
it.each([
  [{ action: 'request', requestId: id, locale: 'sv', confirmed: false }, {}],
  [{ action: 'state', userId: id }, {}],
  [{ action: 'state' }, { Authorization: '' }],
  [{ action: 'state' }, { Origin: 'https://untrusted.test' }],
] as const)(
  'rejects unconfirmed, impersonating, unauthenticated or cross-origin requests',
  async (body, headers) => {
    expect((await POST(req(body, headers))).status).toBeGreaterThanOrEqual(400)
    expect(m.rpc).not.toHaveBeenCalled()
  },
)
it('does not turn MFA or password recovery into a deletion bypass', async () => {
  m.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal2' },
    error: null,
  })
  expect((await POST(req())).status).toBe(403)
  m.getUser.mockResolvedValue({
    data: {
      user: { id, app_metadata: { komisio_password_recovery_pending: true } },
    },
    error: null,
  })
  expect((await POST(req())).status).toBe(409)
  expect(m.rpc).not.toHaveBeenCalled()
})
it('does not report success for a malformed receipt or leak backend errors', async () => {
  m.rpc.mockResolvedValue({ data: { status: 'completed' }, error: null })
  expect((await POST(req())).status).toBe(503)
  m.rpc.mockResolvedValue({
    data: null,
    error: { message: 'private query and contact details' },
  })
  expect(await (await POST(req())).json()).toEqual({ error: 'REQUEST_FAILED' })
})
it('permits only configured preflight origins and command headers', async () => {
  const headers = {
    Origin: 'https://app.example.test',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Authorization, Content-Type',
  }
  const response = await OPTIONS(
    new Request('https://api.example.test', { method: 'OPTIONS', headers }),
  )
  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-origin')).toBe(
    headers.Origin,
  )
  expect(
    (
      await OPTIONS(
        new Request('https://api.example.test', {
          method: 'OPTIONS',
          headers: {
            ...headers,
            'Access-Control-Request-Headers': 'x-impersonate',
          },
        }),
      )
    ).status,
  ).toBe(403)
})
it('requires exact completion evidence and expected revision', () => {
  expect(
    handleDeletionCommand.safeParse({
      kind: 'completed',
      eventId: id,
      requestId: id,
      expected: null,
      evidence: {},
    }).success,
  ).toBe(false)
})
it('allows an absent initial receipt but requires a durable receipt after submission', async () => {
  m.rpc.mockResolvedValue({ data: null, error: null })
  expect(await executeDeletion(m.createClient(), { action: 'state' })).toEqual({
    request: null,
  })
  await expect(
    executeDeletion(m.createClient(), {
      action: 'request',
      requestId: id,
      locale: 'sv',
      confirmed: true,
    }),
  ).rejects.toThrow()
})
