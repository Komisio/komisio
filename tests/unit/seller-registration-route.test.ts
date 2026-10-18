import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platformContext } from '../../lib/platform/context'
import { POST } from '../../app/api/seller-registration/route'
vi.mock('../../lib/platform/context', () => ({ platformContext: vi.fn() }))
const id = 'd3520000-0000-4000-8000-000000000001'
const rpc = vi.fn()
const input = {
  action: 'settings',
  tenantId: id,
  requestId: id,
  expected: null,
  change: 'enable',
}
const request = (origin = 'https://app.example.test') =>
  new Request(origin + '/api/seller-registration', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
beforeEach(() => {
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test')
  vi.mocked(platformContext).mockResolvedValue({
    client: { rpc },
    mfaRequired: false,
    active: { id, role: 'owner' },
  } as unknown as NonNullable<Awaited<ReturnType<typeof platformContext>>>)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})
describe('registration HTTP boundary', () => {
  it('keeps unknown server/transport outcomes retryable with the same command', async () => {
    rpc.mockResolvedValue({
      error: { message: 'Network request failed after sending' },
      data: null,
    })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' })
  })
  it.each([
    ['REGISTRATION_CHANGED', 400],
    ['FORBIDDEN', 403],
    ['AUTH_REQUIRED', 401],
  ])('returns the definite engine failure %s', async (message, status) => {
    rpc.mockResolvedValue({ error: { message }, data: null })
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: message })
  })
  it('rejects cross-origin requests before consulting the account', async () => {
    expect((await POST(request('https://other.example.test'))).status).toBe(403)
    expect(platformContext).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('requires the active store as well as SQL authorization for staff commands', async () => {
    vi.mocked(platformContext).mockResolvedValue({
      client: { rpc },
      mfaRequired: false,
      active: { id: 'd3520000-0000-4000-8000-000000000002', role: 'owner' },
    } as unknown as NonNullable<Awaited<ReturnType<typeof platformContext>>>)
    expect((await POST(request())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})

it.each(['staff', 'viewer'])(
  'blocks %s from the automatic subscription setting',
  async (role) => {
    vi.mocked(platformContext).mockResolvedValue({
      client: { rpc },
      mfaRequired: false,
      active: { id, role },
    } as unknown as NonNullable<Awaited<ReturnType<typeof platformContext>>>)
    const r = await POST(
      new Request('https://app.example.test/api/seller-registration', {
        method: 'POST',
        headers: { origin: 'https://app.example.test' },
        body: JSON.stringify({
          action: 'mailSettings',
          tenantId: id,
          requestId: id,
          expected: null,
          enabled: true,
        }),
      }),
    )
    expect(r.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  },
)
