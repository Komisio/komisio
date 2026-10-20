import base from './playwright.config'
import { defineConfig } from '@playwright/test'
// Explicit separate app process: no provider simulator hook is shipped in application code.
process.env.KOMISIO_ECONOMIC_SIMULATOR = 'true'
const servers = Array.isArray(base.webServer)
  ? base.webServer
  : [base.webServer!]
export default defineConfig({
  ...base,
  testMatch: 'economic.spec.ts',
  webServer: [
    ...servers.slice(0, 2),
    {
      command: 'node tests/fixtures/economic-server.mjs',
      url: 'http://127.0.0.1:3468/health',
      reuseExistingServer: false,
    },
    {
      ...servers[2],
      command:
        'node --env-file=.env.local --import ./tests/fixtures/economic-preload.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000',
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: false,
      env: {
        ...servers[2]?.env,
        NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
        ECONOMIC_APP_SECRET_TOKEN: 'synthetic-economic-secret',
        ECONOMIC_APP_PUBLIC_TOKEN: 'synthetic-economic-public',
      },
    },
  ],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3000' },
})
