import { createHmac } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { handleAuthSms } from '../../lib/platform/auth-sms'
import { POST } from '../../app/api/auth/sms/route'

const key = Buffer.alloc(32, 17)
const env = {
  KOMISIO_AUTH_SMS_HOOK_SECRET: `v1,whsec_${key.toString('base64')}`,
  ELKS_API_USERNAME: 'synthetic-user',
  ELKS_API_PASSWORD: 'synthetic-password',
}
const phone = '+46700000001'
const event = {
  user: { phone, email: 'ignored@example.test' },
  sms: { otp: '123456' },
}
const accepted = {
  id: `s${'a'.repeat(32)}`,
  status: 'created',
  direction: 'outgoing',
  to: phone,
  from: 'Komisio',
}
function signed(payload: unknown = event, now = Date.now(), signingKey = key) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const timestamp = Math.floor(now / 1000).toString()
  const id = 'synthetic-sms-event'
  return {
    raw,
    headers: new Headers({
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${createHmac('sha256', signingKey).update(`${id}.${timestamp}.${raw}`).digest('base64')}`,
    }),
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('sends only the Auth destination and code using fixed branding and no message-history text', async () => {
  const { raw, headers } = signed({
    ...event,
    message: 'attacker text',
    from: 'Attacker',
    to: '+15550000000',
  })
  const request = vi.fn().mockResolvedValue(Response.json(accepted))
  expect(await handleAuthSms(raw, headers, env, request)).toBe(200)
  expect(request).toHaveBeenCalledTimes(1)
  const [url, options] = request.mock.calls[0]
  expect(url).toBe('https://api.46elks.com/a1/sms')
  expect(options.redirect).toBe('error')
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.headers.Authorization).toBe(
    `Basic ${Buffer.from('synthetic-user:synthetic-password').toString('base64')}`,
  )
  const body = new URLSearchParams(options.body)
  expect(Object.fromEntries(body)).toEqual({
    from: 'Komisio',
    to: phone,
    message:
      'Din verifieringskod för Komisio är 123456. Dela inte koden med någon.',
    dontlog: 'message',
  })
  expect(body.get('message')!.length).toBeLessThan(160)
})

it('normalizes Supabase phone values that omit the plus sign', async () => {
  const { raw, headers } = signed({
    user: { phone: phone.slice(1) },
    sms: event.sms,
  })
  const request = vi.fn().mockResolvedValue(Response.json(accepted))
  expect(await handleAuthSms(raw, headers, env, request)).toBe(200)
  expect(new URLSearchParams(request.mock.calls[0][1].body).get('to')).toBe(
    phone,
  )
})

it('rejects unsigned, modified, stale, future and wrong-channel signatures before delivery', async () => {
  const valid = signed()
  const cases = [
    { raw: valid.raw, headers: new Headers() },
    { raw: valid.raw + ' ', headers: valid.headers },
    signed(event, Date.now() - 360000),
    signed(event, Date.now() + 360000),
    signed(event, Date.now(), Buffer.alloc(32, 9)),
  ]
  for (const input of cases) {
    const request = vi.fn()
    expect(await handleAuthSms(input.raw, input.headers, env, request)).toBe(
      401,
    )
    expect(request).not.toHaveBeenCalled()
  }
})

it('fails closed for missing configuration and supports a signed non-sending deployment probe', async () => {
  for (const field of Object.keys(env)) {
    const input = signed()
    const request = vi.fn()
    expect(
      await handleAuthSms(
        input.raw,
        input.headers,
        { ...env, [field]: '' },
        request,
      ),
    ).toBe(field.includes('SECRET') ? 401 : 503)
    expect(request).not.toHaveBeenCalled()
  }
  const probe = signed({ type: 'komisio-auth-sms-probe' })
  const request = vi.fn()
  expect(await handleAuthSms(probe.raw, probe.headers, env, request)).toBe(200)
  expect(request).not.toHaveBeenCalled()
})

it.each([
  'not json',
  { user: {}, sms: event.sms },
  { user: { phone: '0701234567' }, sms: event.sms },
  { user: { phone: '+46 70 1234567' }, sms: event.sms },
  { user: { phone }, sms: { otp: '12345' } },
  { user: { phone }, sms: { otp: '123456 and malicious text' } },
])(
  'rejects invalid signed payloads without contacting the provider: %j',
  async (payload) => {
    const input = signed(payload)
    const request = vi.fn()
    expect(await handleAuthSms(input.raw, input.headers, env, request)).toBe(
      400,
    )
    expect(request).not.toHaveBeenCalled()
  },
)

it('does not retry or expose provider errors, invalid acknowledgements or uncertain sends', async () => {
  const responses = [
    new Response('private provider error 123456', { status: 401 }),
    new Response('private provider error 123456', { status: 503 }),
    Response.json({ ...accepted, status: 'failed' }),
    Response.json({ ...accepted, to: '+15550000000' }),
    Response.json({ ...accepted, id: undefined }),
    new Response('not JSON'),
  ]
  const input = signed()
  for (const response of responses) {
    const request = vi.fn().mockResolvedValue(response)
    expect(await handleAuthSms(input.raw, input.headers, env, request)).toBe(
      400,
    )
    expect(request).toHaveBeenCalledTimes(1)
  }
  const timeout = vi.fn().mockRejectedValue(new Error('private phone and code'))
  expect(await handleAuthSms(input.raw, input.headers, env, timeout)).toBe(400)
  expect(timeout).toHaveBeenCalledTimes(1)
})

it('bounds actual streamed bodies and returns only generic uncached failures', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const large = await POST(
    new Request('https://example.test/api/auth/sms', {
      method: 'POST',
      body: 'a'.repeat(262145),
      headers: { 'content-length': '1' },
    }),
  )
  expect(large.status).toBe(413)
  const unsigned = await POST(
    new Request('https://example.test/api/auth/sms', {
      method: 'POST',
      body: JSON.stringify(event),
    }),
  )
  expect(unsigned.status).toBe(401)
  expect(unsigned.headers.get('cache-control')).toBe('no-store')
  expect(await unsigned.json()).toEqual({
    error: { http_code: 401, message: 'SMS delivery could not be completed' },
  })
  expect(request).not.toHaveBeenCalled()
})

it('returns an empty success object to Auth after one accepted send', async () => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const input = signed()
  const send = vi.fn().mockResolvedValue(Response.json(accepted))
  vi.stubGlobal('fetch', send)
  const result = await POST(
    new Request('https://example.test/api/auth/sms', {
      method: 'POST',
      headers: input.headers,
      body: input.raw,
    }),
  )
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({})
  expect(send).toHaveBeenCalledTimes(1)
})
