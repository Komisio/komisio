import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const config = {
  NEXT_PUBLIC_APP_URL: 'https://staging.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
  KOMISIO_ENVIRONMENT: 'staging',
  INVITATION_EMAIL_DELIVERY: 'manual',
}
const check = (overrides = {}) =>
  spawnSync(process.execPath, ['scripts/check-hosted-env.mjs'], {
    env: { ...process.env, ...config, ...overrides },
    encoding: 'utf8',
  })
it('accepts an isolated hosted staging configuration', () =>
  expect(check().status).toBe(0))
it('rejects privileged keys without printing their value', () => {
  const secret = 'sb_secret_never_print_this'
  const result = check({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret })
  expect(result.status).toBe(1)
  expect(result.stderr + result.stdout).not.toContain(secret)
})
it('rejects legacy service-role JWTs', () => {
  const token =
    'header.' +
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString(
      'base64url',
    ) +
    '.signature'
  expect(check({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token }).status).toBe(1)
})
it('rejects local callbacks and accidental production configuration', () => {
  expect(check({ NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' }).status).toBe(1)
  expect(check({ KOMISIO_ENVIRONMENT: 'production' }).status).toBe(1)
})
it('requires explicit pilot recipient configuration before email can be enabled', () => {
  expect(
    check({
      INVITATION_EMAIL_DELIVERY: 'resend',
      INVITATION_EMAIL_ALLOWLIST: '',
    }).status,
  ).toBe(1)
})
