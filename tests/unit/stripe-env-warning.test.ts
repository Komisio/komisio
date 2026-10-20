import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Stripe Tax deployment warning', () => {
  it.each(['', 'false', 'TRUE', 'true'])(
    'warns without failing for %s',
    (flag) => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('../../scripts/check-hosted-env.mjs', import.meta.url),
          ),
        ],
        {
          encoding: 'utf8',
          env: {
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'test',
            NEXT_PUBLIC_APP_URL: 'https://app.example.test',
            NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test',
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
            KOMISIO_ENVIRONMENT: 'production',
            INVITATION_EMAIL_DELIVERY: 'resend',
            RESEND_API_KEY: 'synthetic',
            INVITATION_EMAIL_FROM: 'test@example.test',
            INVITATION_EMAIL_ALLOWLIST: '*',
            KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
            CRON_SECRET: 'synthetic-long-secret',
            KOMISIO_AUTOMATION_EMAIL: 'actor@example.test',
            KOMISIO_AUTOMATION_PASSWORD: 'synthetic-long-password',
            STRIPE_SECRET_KEY: 'sk_test_synthetic000000',
            STRIPE_PRICE_ID: 'price_synthetic00000',
            KOMISIO_STRIPE_AUTOMATIC_TAX: flag,
          },
        },
      )
      expect(result.status).toBe(0)
      expect(result.stderr.includes('automatic tax is off')).toBe(
        flag !== 'true',
      )
      expect(result.stderr).not.toContain('sk_test_')
    },
  )
})
