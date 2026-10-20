import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock('@/lib/platform/context', () => ({ platformContext: mocks.context }))
import { POST } from '../../app/api/platform/route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
function fixture() {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateUser = vi
    .fn()
    .mockResolvedValue({ data: { user: {} }, error: null })
  mocks.context.mockResolvedValue({
    client: { rpc, auth: { updateUser } },
    mfaRequired: false,
  })
  const save = () =>
    POST(
      new Request('http://localhost:3000/api/platform', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: JSON.stringify({
          action: 'profile',
          name: 'Synthetic user',
          locale: 'dk',
        }),
      }),
    )
  return { rpc, updateUser, save }
}
it('mirrors an authorized profile save through the same user session without requiring store membership', async () => {
  const f = fixture()
  expect((await f.save()).status).toBe(200)
  expect(f.rpc).toHaveBeenCalledWith('save_profile', {
    p_name: 'Synthetic user',
    p_locale: 'dk',
  })
  expect(f.updateUser).toHaveBeenCalledWith({
    data: { locale: 'dk', product_locale: 'dk' },
  })
  expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(
    f.updateUser.mock.invocationCallOrder[0],
  )
})
it('does not change Auth metadata when profile authorization fails', async () => {
  const f = fixture()
  f.rpc.mockResolvedValueOnce({
    error: { message: 'FORBIDDEN', code: '42501' },
  })
  expect((await f.save()).status).toBe(403)
  expect(f.updateUser).not.toHaveBeenCalled()
})
it.each(['error', 'timeout'])(
  'reports incomplete synchronization on %s and safely retries the same preference',
  async (kind) => {
    const f = fixture()
    if (kind === 'error')
      f.updateUser.mockResolvedValueOnce({
        error: { message: 'synthetic failure' },
      })
    else f.updateUser.mockRejectedValueOnce(new Error('timeout'))
    const failed = await f.save()
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({
      error: 'PROFILE_EMAIL_LANGUAGE_FAILED',
    })
    expect((await f.save()).status).toBe(200)
    expect(f.updateUser).toHaveBeenCalledTimes(2)
    expect(f.updateUser.mock.calls[0]).toEqual(f.updateUser.mock.calls[1])
  },
)
it.each([null, { mfaRequired: true }])(
  'requires the authenticated MFA-cleared session',
  async (context) => {
    const f = fixture()
    mocks.context.mockResolvedValueOnce(context)
    expect((await f.save()).status).toBe(context ? 403 : 401)
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.updateUser).not.toHaveBeenCalled()
  },
)
