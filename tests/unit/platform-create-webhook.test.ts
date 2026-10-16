import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  after: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/lib/platform/context', () => ({ platformContext: mocks.context }))
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: mocks.after,
}))
import { POST } from '../../app/api/platform/route'

const tenant = '10000000-0000-4000-8000-000000000002'
let callbacks: (() => Promise<void>)[]
let fetcher: ReturnType<typeof vi.fn>
const request = () =>
  new Request('https://komisio.example.test/api/platform', {
    method: 'POST',
    headers: {
      origin: 'https://komisio.example.test',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'create',
      name: 'Synthetic shop',
      slug: 'synthetic-shop',
      requestId: '10000000-0000-4000-8000-000000000001',
    }),
  })
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://komisio.example.test')
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_URL', 'https://events.example.test')
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_SECRET', 'synthetic-secret')
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_TIMEOUT_MS', '25')
  fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  callbacks = []
  mocks.after.mockImplementation((callback) => callbacks.push(callback))
  mocks.rpc.mockResolvedValue({
    data: { tenant_id: tenant, created: true },
    error: null,
  })
  mocks.context.mockResolvedValue({
    client: { rpc: mocks.rpc },
    mfaRequired: false,
    user: { email: 'owner@example.test' },
    profile: { display_name: 'Synthetic owner' },
    locale: 'no',
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})
it.each([
  'disabled',
  'missing secret',
  'success',
  'http error',
  'network error',
  'timeout',
  'scheduling error',
])('creation succeeds independently of webhook: %s', async (mode) => {
  if (mode === 'disabled') vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_URL', '')
  if (mode === 'missing secret') vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_SECRET', '')
  if (mode === 'http error')
    fetcher.mockResolvedValue(new Response('private response', { status: 500 }))
  if (mode === 'network error')
    fetcher.mockRejectedValue(new Error('private receiver error'))
  if (mode === 'scheduling error')
    mocks.after.mockImplementation(() => {
      throw new Error('private scheduler error')
    })
  if (mode === 'timeout') {
    vi.useFakeTimers()
    fetcher.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () =>
            reject(new Error('private timeout')),
          ),
        ),
    )
  }
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, data: tenant })
  expect(fetcher).not.toHaveBeenCalled()
  expect(callbacks.length).toBe(
    ['disabled', 'scheduling error'].includes(mode) ? 0 : 1,
  )
  const delivery = Promise.all(callbacks.map((callback) => callback()))
  if (mode === 'timeout') await vi.advanceTimersByTimeAsync(25)
  await expect(delivery).resolves.toBeDefined()
  if (mode === 'success') {
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body).data).toEqual({
      tenant_id: tenant,
      shop_name: 'Synthetic shop',
      owner_email: 'owner@example.test',
      owner_display_name: 'Synthetic owner',
      locale: 'no',
    })
  }
  if (mode === 'missing secret') expect(fetcher).not.toHaveBeenCalled()
})
it('does not schedule an event for a replay or failed creation', async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: { tenant_id: tenant, created: false },
    error: null,
  })
  expect((await POST(request())).status).toBe(200)
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: 'FORBIDDEN', code: '42501' },
  })
  expect((await POST(request())).status).toBe(403)
  expect(mocks.after).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})
