import { expect, it, vi } from 'vitest'
import { configureAuthSmsHook } from '../../scripts/configure-auth-sms-hook.mjs'
import { verifyAuthWebhookSignature } from '../../lib/platform/auth-webhook'

const env = {
  NODE_ENV: 'test' as const,
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'synthetic',
  KOMISIO_AUTH_SMS_HOOK_SECRET: `v1,whsec_${Buffer.alloc(32, 17).toString('base64')}`,
}
const current = {
  site_url: 'https://app.komisio.com',
  external_phone_enabled: false,
  sms_autoconfirm: false,
  sms_max_frequency: 5,
  rate_limit_sms_sent: 30,
  external_email_enabled: true,
  hook_send_email_enabled: true,
  hook_send_email_uri: 'https://app.komisio.com/api/auth/email',
  mailer_autoconfirm: false,
  security_mfa_enabled: true,
  uri_allow_list: 'https://app.komisio.com/auth/callback',
}
function mockRequests(state = current) {
  let patch: Record<string, unknown> = {}
  const request = vi.fn().mockImplementation(async (url, options = {}) => {
    if (url === `${state.site_url}/api/auth/sms`) return Response.json({})
    if (options.method === 'PATCH') {
      patch = JSON.parse(options.body)
      return Response.json({})
    }
    return Response.json({ ...state, ...patch })
  })
  return { request, patch: () => patch }
}

it('probes first, enables confirmed phone login with limits, and preserves all email/MFA settings', async () => {
  const { request, patch } = mockRequests()
  await configureAuthSmsHook('production', env, request)
  expect(patch()).toEqual({
    hook_send_sms_enabled: true,
    hook_send_sms_uri: 'https://app.komisio.com/api/auth/sms',
    hook_send_sms_secrets: env.KOMISIO_AUTH_SMS_HOOK_SECRET,
    external_phone_enabled: true,
    sms_autoconfirm: false,
    sms_max_frequency: 60,
    rate_limit_sms_sent: 20,
  })
  const probe = request.mock.calls[1][1]
  expect(
    verifyAuthWebhookSignature(
      probe.body,
      new Headers(probe.headers),
      env.KOMISIO_AUTH_SMS_HOOK_SECRET,
    ),
  ).toBe(true)
  expect(JSON.parse(probe.body)).toEqual({ type: 'komisio-auth-sms-probe' })
  expect(request.mock.calls[2][1].method).toBe('PATCH')
})

it('keeps stricter limits and supports staging without touching production', async () => {
  const { request, patch } = mockRequests({
    ...current,
    site_url: 'https://komisio-staging.vercel.app',
    sms_max_frequency: 120,
    rate_limit_sms_sent: 10,
  })
  await configureAuthSmsHook('staging', env, request)
  expect(patch().sms_max_frequency).toBe(120)
  expect(patch().rate_limit_sms_sent).toBe(10)
  expect(patch().hook_send_sms_uri).toBe(
    'https://komisio-staging.vercel.app/api/auth/sms',
  )
})

it('refuses feature branches, wrong environments, different transports and hosted test codes before mutation', async () => {
  const request = vi.fn()
  await expect(
    configureAuthSmsHook(
      'production',
      { ...env, GITHUB_REF: 'refs/heads/feature' },
      request,
    ),
  ).rejects.toThrow('protected')
  expect(request).not.toHaveBeenCalled()
  for (const state of [
    { ...current, site_url: 'https://unexpected.example.test' },
    { ...current, external_phone_enabled: true },
    {
      ...current,
      hook_send_sms_enabled: true,
      hook_send_sms_uri: 'https://other.example.test/hook',
    },
    { ...current, sms_test_otp: '46700000001:123456' },
  ]) {
    const blocked = vi.fn().mockResolvedValue(Response.json(state))
    await expect(
      configureAuthSmsHook('production', env, blocked),
    ).rejects.toThrow()
    expect(blocked).toHaveBeenCalledTimes(1)
  }
})

it('does not activate SMS when the signed handler probe fails', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json(current))
    .mockResolvedValueOnce(new Response('', { status: 401 }))
  await expect(
    configureAuthSmsHook('production', env, request),
  ).rejects.toThrow('Deploy')
  expect(request).toHaveBeenCalledTimes(2)
})

it('fails readback if another Auth setting or the requested configuration differs', async () => {
  for (const changed of [
    { external_email_enabled: false },
    { external_phone_enabled: false },
  ]) {
    const { request } = mockRequests()
    const run = request.getMockImplementation()!
    request.mockImplementation(async (url, options) => {
      const result = await run(url, options)
      if (request.mock.calls.length === 4)
        return Response.json({ ...(await result.json()), ...changed })
      return result
    })
    await expect(
      configureAuthSmsHook('production', env, request),
    ).rejects.toThrow(/changed|mismatch/)
  }
})
