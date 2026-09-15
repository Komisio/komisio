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
it('rejects local callbacks and a production flag on a staging shape', () => {
  expect(check({ NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' }).status).toBe(1)
  expect(check({ KOMISIO_ENVIRONMENT: 'production' }).status).toBe(1)
  expect(check({ KOMISIO_ENVIRONMENT: 'demo' }).status).toBe(1)
})
const production = {
  KOMISIO_ENVIRONMENT: 'production',
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
  INVITATION_EMAIL_DELIVERY: 'resend',
  RESEND_API_KEY: 're_test_only',
  INVITATION_EMAIL_FROM: 'Komisio <noreply@example.test>',
  INVITATION_EMAIL_ALLOWLIST: 'owner@example.test',
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  CRON_SECRET: 'cron-secret-long-enough',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'password-long-enough',
}
it('accepts a complete production shape', () =>
  expect(check(production).status).toBe(0))
it.each([
  { NEXT_PUBLIC_APP_URL: 'https://komisio-staging.vercel.app' },
  { INVITATION_EMAIL_DELIVERY: 'manual' },
  { KOMISIO_CREDENTIAL_KEY: 'short' },
  { CRON_SECRET: 'short' },
  { KOMISIO_AUTOMATION_PASSWORD: 'short' },
  { SHOPIFY_ACCEPT_TEST_ORDERS: 'true' },
])('refuses a production build with %j', (change) => {
  const result = check({ ...production, ...change })
  expect(result.status).toBe(1)
  expect(result.stderr + result.stdout).not.toContain('re_test_only')
})
it('requires explicit pilot recipient configuration before email can be enabled', () => {
  expect(
    check({
      INVITATION_EMAIL_DELIVERY: 'resend',
      INVITATION_EMAIL_ALLOWLIST: '',
    }).status,
  ).toBe(1)
})
