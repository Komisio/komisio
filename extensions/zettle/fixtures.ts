import { zettleHttpClient } from './http'
import { fixtureZettleTransport } from './transport'
/** Synthetic, documented wire shape. No merchant/customer/card data. */
export function demoTransport() {
  return fixtureZettleTransport([
    {
      cursor: null,
      response: {
        lastPurchaseHash: 'synthetic-page-1',
        purchases: [
          {
            purchaseUUID1: 'e17e0000-0000-4000-8000-000000000001',
            timestamp: '2026-09-10T10:00:00.000+0000',
            amount: 30000,
            currency: 'SEK',
            source: 'POS',
            products: [
              {
                type: 'PRODUCT',
                quantity: '1',
                unitPrice: 20000,
                name: 'TEST jacket',
                sku: 'I-AABBCCDD',
              },
              {
                type: 'PRODUCT',
                quantity: '1',
                unitPrice: 10000,
                name: 'TEST bag',
                sku: 'I-EEFF0011',
              },
            ],
          },
        ],
      },
    },
    { cursor: 'synthetic-page-1', response: { purchases: [] } },
  ])
}
/** Two explicit local hosts; never enabled by the flag alone in hosted staging. */
export function zettleFixturesEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.KOMISIO_ZETTLE_FIXTURES !== 'true') return false
  try {
    return [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_SUPABASE_URL].every(
      (value) =>
        !!value && ['127.0.0.1', 'localhost'].includes(new URL(value).hostname),
    )
  } catch {
    return false
  }
}

/** Exercise the real HTTP adapter against an isolated loopback simulator. */
export function localZettleClient(tenantId: string) {
  if (!zettleFixturesEnabled()) throw new Error('ZETTLE_NOT_CONNECTED')
  return zettleHttpClient({
    organizationId: tenantId,
    accessToken: async () => `fixture:${tenantId}`,
    startDate: '2020-01-01T00:00:00.000Z',
    endDate: '2100-01-01T00:00:00.000Z',
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (
        ![
          'products.izettle.com',
          'purchase.izettle.com',
          'oauth.zettle.com',
        ].includes(url.hostname)
      )
        throw new Error('ZETTLE_UNEXPECTED_HOST')
      return fetch(
        `http://127.0.0.1:3456/${url.hostname}${url.pathname}${url.search}`,
        init,
      )
    },
  })
}
