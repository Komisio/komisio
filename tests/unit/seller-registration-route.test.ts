import { after } from 'next/server'
import { notifyRegistrationApproval } from '../../lib/communications/registration-approval'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platformContext } from '../../lib/platform/context'
import { POST } from '../../app/api/seller-registration/route'
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('../../lib/communications/registration-approval', () => ({
  notifyRegistrationApproval: vi.fn(),
}))
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
    locale: 'dk',
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

const commandRequest = (body: object) =>
  new Request('https://app.example.test/api/seller-registration', {
    method: 'POST',
    headers: { origin: 'https://app.example.test' },
    body: JSON.stringify(body),
  })
it('schedules the approval reply only after a committed approval and keeps it out of the response', async () => {
  rpc.mockResolvedValue({ data: id, error: null })
  const response = await POST(
    commandRequest({
      action: 'review',
      tenantId: id,
      requestId: id,
      registrationId: id,
      approved: true,
    }),
  )
  expect(response.status).toBe(200)
  expect(after).toHaveBeenCalledTimes(1)
  expect(notifyRegistrationApproval).not.toHaveBeenCalled()
  await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)()
  expect(notifyRegistrationApproval).toHaveBeenCalledWith({ rpc }, id, id)
})
it.each([false, true])(
  'never schedules an approval reply for rejection or failed review (failure %s)',
  async (failure) => {
    rpc.mockResolvedValue({
      data: id,
      error: failure ? { message: 'REGISTRATION_REVIEWED' } : null,
    })
    await POST(
      commandRequest({
        action: 'review',
        tenantId: id,
        requestId: id,
        registrationId: id,
        approved: failure,
      }),
    )
    expect(after).not.toHaveBeenCalled()
  },
)
it('captures the application language from the verified server context', async () => {
  rpc.mockResolvedValue({ data: { state: 'submitted' }, error: null })
  const response = await POST(
    commandRequest({
      action: 'apply',
      token: 'a'.repeat(64),
      requestId: id,
      name: 'Synthetic',
      phone: '000',
      agreementId: id,
      translationId: null,
      accepted: true,
    }),
  )
  expect(response.status).toBe(200)
  expect(rpc).toHaveBeenCalledWith(
    'submit_seller_registration_in_language',
    expect.objectContaining({ p_locale: 'dk' }),
  )
  expect(after).not.toHaveBeenCalled()
})
