import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emitEvent, scheduleEvent } from '../../lib/events/webhook'

const data = {
  tenant_id: '10000000-0000-4000-8000-000000000002',
  shop_name: 'Synthetic private shop',
  owner_email: 'synthetic-owner@example.test',
  owner_display_name: 'Synthetic private owner',
  locale: 'sv' as const,
}
const secret = 'synthetic-signing-secret'
const endpoint = 'https://events.example.test/private-endpoint'
let fetcher: ReturnType<typeof vi.fn>
let warning: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_URL', endpoint)
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_SECRET', secret)
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_TIMEOUT_MS', '3000')
  fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  const logs = JSON.stringify(warning.mock.calls)
  for (const value of [
    data.shop_name,
    data.owner_email,
    data.owner_display_name,
    secret,
    endpoint,
    data.tenant_id,
  ])
    expect(logs).not.toContain(value)
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('does nothing, including scheduling, when disabled', async () => {
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_URL', '')
  const afterResponse = vi.fn()
  scheduleEvent(afterResponse, 'tenant.created', data)
  await emitEvent('tenant.created', data)
  expect(afterResponse).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(warning).not.toHaveBeenCalled()
})
it('warns only once and never sends an unsigned request', async () => {
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_SECRET', '')
  await emitEvent('tenant.created', data)
  await emitEvent('tenant.created', data)
  expect(fetcher).not.toHaveBeenCalled()
  expect(warning).toHaveBeenCalledTimes(1)
})
it.each([
  'http://events.example.test',
  'https://name:password@events.example.test',
  'not-a-url',
])('refuses unsafe or invalid configuration %s', async (url) => {
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_URL', url)
  await emitEvent('tenant.created', data)
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['0', '-1', 'NaN', '30001', '1.5'])(
  'refuses invalid timeout %s',
  async (timeout) => {
    vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_TIMEOUT_MS', timeout)
    await emitEvent('tenant.created', data)
    expect(fetcher).not.toHaveBeenCalled()
  },
)
it('sends one signed POST with the exact documented payload and a unique delivery ID', async () => {
  await emitEvent('tenant.created', data)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, options] = fetcher.mock.calls[0]
  expect(url.toString()).toBe(endpoint)
  expect(options.method).toBe('POST')
  expect(options.redirect).toBe('error')
  const body = JSON.parse(options.body)
  expect(body).toEqual({
    event: 'tenant.created',
    event_id: expect.any(String),
    created_at: expect.any(String),
    data,
  })
  expect(body.event_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(new Date(body.created_at).toISOString()).toBe(body.created_at)
  const timestamp = options.headers['X-Komisio-Timestamp']
  expect(Number(timestamp)).toBe(
    Math.floor(new Date(body.created_at).getTime() / 1000),
  )
  expect(options.headers).toEqual({
    'Content-Type': 'application/json',
    'X-Komisio-Event': 'tenant.created',
    'X-Komisio-Delivery': body.event_id,
    'X-Komisio-Timestamp': timestamp,
    'X-Komisio-Signature': `sha256=${createHmac('sha256', secret).update(`${timestamp}.${options.body}`).digest('hex')}`,
  })
  await emitEvent('tenant.created', data)
  expect(JSON.parse(fetcher.mock.calls[1][1].body).event_id).not.toBe(
    body.event_id,
  )
})
it('swallows non-2xx and network failures without retries or personal-data logs', async () => {
  fetcher.mockResolvedValueOnce(new Response(data.owner_email, { status: 500 }))
  await expect(emitEvent('tenant.created', data)).resolves.toBeUndefined()
  fetcher.mockRejectedValueOnce(
    new Error(`${endpoint} ${secret} ${data.owner_email}`),
  )
  await expect(emitEvent('tenant.created', data)).resolves.toBeUndefined()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(warning).toHaveBeenCalledWith(
    'events-webhook: delivery failed (status=500)',
  )
  expect(warning).toHaveBeenCalledWith('events-webhook: delivery failed')
})
it('aborts at the default timeout, swallows failure and clears its timer', async () => {
  vi.useFakeTimers()
  vi.stubEnv('KOMISIO_EVENTS_WEBHOOK_TIMEOUT_MS', undefined)
  fetcher.mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () =>
          reject(new Error(data.owner_email)),
        ),
      ),
  )
  const delivery = emitEvent('tenant.created', data)
  await vi.advanceTimersByTimeAsync(2999)
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await expect(delivery).resolves.toBeUndefined()
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('defers delivery until after the response and swallows scheduling failures', async () => {
  let callback: (() => Promise<void>) | undefined
  scheduleEvent(
    (task) => {
      callback = task
    },
    'tenant.created',
    data,
  )
  expect(fetcher).not.toHaveBeenCalled()
  await callback!()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(() =>
    scheduleEvent(
      () => {
        throw new Error(secret)
      },
      'tenant.created',
      data,
    ),
  ).not.toThrow()
})
