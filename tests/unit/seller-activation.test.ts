import { expect, it, vi } from 'vitest'
import { sendSellerActivation } from '../../lib/platform/seller-activation'

const env = {
  SELLER_EMAIL_DELIVERY: 'resend',
  SELLER_EMAIL_ALLOWLIST: 'seller@example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
}
it('requests creation or reuse through public Auth without passwords, sessions or admin credentials', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}'))
  expect(
    await sendSellerActivation(
      'seller@example.test',
      'sv',
      undefined,
      env,
      request,
    ),
  ).toEqual({ status: 'sent', providerMessageId: 'supabase-auth' })
  const [url, options] = request.mock.calls[0]
  expect(url.origin).toBe('https://auth.example.test')
  expect(url.pathname).toBe('/auth/v1/otp')
  expect(url.searchParams.get('redirect_to')).toBe(
    'https://app.example.test/auth/activate',
  )
  expect(options.headers).toEqual({
    apikey: 'public-key',
    'Content-Type': 'application/json',
  })
  expect(JSON.parse(options.body)).toEqual({
    email: 'seller@example.test',
    create_user: true,
    data: { locale: 'sv' },
  })
  expect(options.redirect).toBe('error')
})
it('respects manual delivery, recipient restrictions and incomplete configuration', async () => {
  for (const [override, status] of [
    [{ SELLER_ACCOUNT_DELIVERY: 'manual' }, 'manual'],
    [{ SELLER_EMAIL_ALLOWLIST: '' }, 'restricted'],
    [{ SELLER_EMAIL_ALLOWLIST: 'different@example.test' }, 'restricted'],
    [{ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }, 'failed'],
  ] as const) {
    const request = vi.fn()
    expect(
      (
        await sendSellerActivation(
          'seller@example.test',
          'en',
          undefined,
          { ...env, ...override },
          request,
        )
      ).status,
    ).toBe(status)
    expect(request).not.toHaveBeenCalled()
  }
})
it('binds branded activation to an opaque ticket without putting names or message copy in Auth metadata', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}'))
  expect(
    (
      await sendSellerActivation(
        'seller@example.test',
        'sv',
        'ab'.repeat(32),
        { ...env, KOMISIO_AUTH_EMAIL_HOOK_SECRET: 'configured' },
        request,
      )
    ).status,
  ).toBe('sent')
  const [url, options] = request.mock.calls[0]
  expect(
    new URL(url.searchParams.get('redirect_to')).searchParams.get('ticket'),
  ).toBe('ab'.repeat(32))
  expect(JSON.parse(options.body).data).toEqual({ locale: 'sv' })
  request.mockClear()
  expect(
    (
      await sendSellerActivation(
        'seller@example.test',
        'sv',
        'ab'.repeat(32),
        env,
        request,
      )
    ).status,
  ).toBe('failed')
  expect(request).not.toHaveBeenCalled()
})
it('never retries uncertain responses or exposes provider bodies', async () => {
  for (const [code, status] of [
    [429, 'failed'],
    [400, 'failed'],
    [503, 'unconfirmed'],
  ] as const) {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response('private provider details', { status: code }),
      )
    expect(
      await sendSellerActivation(
        'seller@example.test',
        'en',
        undefined,
        env,
        request,
      ),
    ).toEqual({ status, providerMessageId: '' })
    expect(request).toHaveBeenCalledTimes(1)
  }
  expect(
    (
      await sendSellerActivation(
        'seller@example.test',
        'en',
        undefined,
        env,
        vi.fn().mockRejectedValue(new Error('timeout')),
      )
    ).status,
  ).toBe('unconfirmed')
})
