import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  // The dev server compiles a page on its first hit in CI; give expectations room.
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx tests/fixtures/zettle-server.ts',
      url: 'http://127.0.0.1:3456/health',
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    },
    {
      command: 'npm run dev',
      env: {
        KOMISIO_ZETTLE_FIXTURES: 'true',
        KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
        SHOPIFY_CLIENT_SECRET: 'synthetic-shopify-privacy-secret',
      },
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
})
