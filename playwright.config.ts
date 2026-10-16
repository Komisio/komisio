import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  // Allow asynchronous responses and first-load compilation in local development.
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  // Stop known-red CI runs early; a green release still runs the whole suite.
  maxFailures: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'node --env-file=.env.local --import tsx tests/fixtures/auth-email-server.ts',
      url: 'http://127.0.0.1:3457/health',
      reuseExistingServer: true,
    },
    {
      command: 'node --import tsx tests/fixtures/zettle-server.ts',
      url: 'http://127.0.0.1:3456/health',
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    },
    {
      // CI already builds the application; exercise that artifact without recompiling pages.
      command: process.env.CI ? 'npm run start' : 'npm run dev',
      env: {
        SELLER_ACCOUNT_DELIVERY: 'auth',
        KOMISIO_AUTH_EMAIL_HOOK_ENABLED: 'true',
        KOMISIO_AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${Buffer.alloc(32, 7).toString('base64')}`,
        SELLER_EMAIL_ALLOWLIST: '*',
        KOMISIO_ZETTLE_FIXTURES: 'true',
        KOMISIO_SELLER_SUBMISSIONS_ENABLED: 'true',
        KOMISIO_CONNECTORS_ENABLED: 'true',
        KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
        PAYPAL_POS_CLIENT_ID: 'synthetic-paypal-public-app',
        PAYPAL_POS_CLIENT_SECRET: 'synthetic-paypal-client-secret',
        SHOPIFY_CLIENT_SECRET: 'synthetic-shopify-privacy-secret',
        KOMISIO_AUTOMATION_EMAIL: 'automation-e2e@example.test',
        KOMISIO_AUTOMATION_PASSWORD: 'synthetic-automation-e2e-password',
      },
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
})
