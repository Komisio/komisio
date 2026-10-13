import { expect, it, vi } from 'vitest'
import { configureAuthEmailHook } from '../../scripts/configure-auth-email-hook.mjs'
import { verifyAuthEmailSignature } from '../../lib/platform/auth-email'
const env = {
  NODE_ENV: 'test' as const,
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'synthetic',
  KOMISIO_AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${Buffer.alloc(32, 8).toString('base64')}`,
}
const current = {
  site_url: 'https://app.example.test',
  uri_allow_list: 'https://app.example.test/auth/callback',
}
it('probes the deployed handler with the matching key before updating only hook and redirect settings', async () => {
  const expected = {
    hook_send_email_enabled: true,
    hook_send_email_uri: 'https://app.example.test/api/auth/email',
    uri_allow_list:
      current.uri_allow_list +
      ',https://app.example.test/auth/activate?ticket=*',
  }
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json(current))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json(expected))
  await configureAuthEmailHook('production', env, request)
  const probe = request.mock.calls[1][1]
  expect(
    verifyAuthEmailSignature(
      probe.body,
      new Headers(probe.headers),
      env.KOMISIO_AUTH_EMAIL_HOOK_SECRET,
    ),
  ).toBe(true)
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
    ...expected,
    hook_send_email_secrets: env.KOMISIO_AUTH_EMAIL_HOOK_SECRET,
  })
})
it('does not change Auth before the deployed receiver accepts the key', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json(current))
    .mockResolvedValueOnce(new Response('', { status: 401 }))
  await expect(configureAuthEmailHook('staging', env, request)).rejects.toThrow(
    'Deploy',
  )
  expect(request).toHaveBeenCalledTimes(2)
})
it('refuses unprotected contexts and replacing a different hook', async () => {
  const request = vi.fn()
  await expect(
    configureAuthEmailHook(
      'production',
      { ...env, GITHUB_REF: 'refs/heads/feature' },
      request,
    ),
  ).rejects.toThrow('protected')
  expect(request).not.toHaveBeenCalled()
  request.mockResolvedValueOnce(
    Response.json({
      ...current,
      hook_send_email_enabled: true,
      hook_send_email_uri: 'https://another.example.test/hook',
    }),
  )
  await expect(
    configureAuthEmailHook('production', env, request),
  ).rejects.toThrow('different')
  expect(request).toHaveBeenCalledTimes(1)
})
