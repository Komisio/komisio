import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Separate process: legacy/manual pairing remains covered by the ordinary suite.
// This suite checks managed setup UI with intercepted, synthetic responses.
export default defineConfig({
  ...base,
  testDir: './tests/managed-weblink',
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map(
    (server, index, all) =>
      index === all.length - 1
        ? {
            ...server,
            reuseExistingServer: false,
            env: {
              ...server.env,
              KOMISIO_WEBLINK_MANAGEMENT_URL: 'https://print.example.test',
              KOMISIO_WEBLINK_MANAGEMENT_SECRET: 's'.repeat(43),
            },
          }
        : server,
  ),
})
