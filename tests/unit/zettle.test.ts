import { expect, it } from 'vitest'
import {
  mapZettlePurchase,
  mapZettlePage,
} from '../../extensions/zettle/purchase'
import { fixtureZettleTransport } from '../../extensions/zettle/transport'
const base = {
  purchaseUUID1: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-09-10T10:00:00.000+0000',
  currency: 'SEK',
  amount: 20000,
  source: 'POS',
  products: [
    {
      type: 'PRODUCT',
      quantity: '1.000',
      unitPrice: 20000,
      name: 'Synthetic jacket',
      sku: 'I-1234ABCD',
    },
  ],
}
it('maps documented UUID, integer gross and exact labels, stripping unrelated data', () => {
  const mapped = mapZettlePurchase({
    ...base,
    purchaseUUID: 'deprecated',
    payments: [{ card: 'secret' }],
    gpsCoordinates: 'private',
  })
  expect(mapped).toEqual({
    externalId: base.purchaseUUID1,
    occurredAt: '2026-09-10T10:00:00.000Z',
    amountOre: 20000,
    currency: 'SEK',
    blockedReason: null,
    lines: [
      {
        lineNo: 1,
        reference: 'I-1234ABCD',
        labelConflict: false,
        description: 'Synthetic jacket',
        priceOre: 20000,
      },
    ],
  })
})
it.each([
  { source: 'WEB_SHOP' },
  { refund: true },
  { refunded: true },
  { amount: -20000 },
  { currency: 'EUR' },
  { discounts: [{}] },
  { serviceCharge: {} },
  { amount: 20001 },
  { products: [{ ...base.products[0], quantity: '2' }] },
  { products: [{ ...base.products[0], type: 'GIFTCARD' }] },
  { products: [{ ...base.products[0], discountValue: 1 }] },
])('holds unsupported purchase %j', (patch) => {
  expect(mapZettlePurchase({ ...base, ...patch }).blockedReason).not.toBeNull()
})
it('conflicting labels cannot choose an item; partial string matches are not labels', () => {
  expect(
    mapZettlePurchase({
      ...base,
      products: [{ ...base.products[0], barcode: 'I-99999999' }],
    }).lines[0],
  ).toMatchObject({ reference: null, labelConflict: true })
  expect(
    mapZettlePurchase({
      ...base,
      products: [{ ...base.products[0], sku: 'other I-1234ABCD' }],
    }).lines[0].reference,
  ).toBeNull()
})
it.each([
  { purchaseUUID1: undefined, purchaseUUID: base.purchaseUUID1 },
  { timestamp: 'yesterday' },
  { amount: Number.MAX_SAFE_INTEGER },
  { products: [] },
  { products: [{ ...base.products[0], unitPrice: 1.5 }] },
])('rejects malformed %j', (patch) => {
  expect(() => mapZettlePurchase({ ...base, ...patch })).toThrow()
})
it('cursor only advances after a complete valid page', () => {
  expect(
    mapZettlePage({ purchases: [base], lastPurchaseHash: 'next' }, null)
      .nextCursor,
  ).toBe('next')
  expect(
    mapZettlePage({ purchases: [], lastPurchaseHash: 'ignored' }, 'next')
      .nextCursor,
  ).toBe('next')
  expect(() =>
    mapZettlePage({ purchases: [base], lastPurchaseHash: 'next' }, 'next'),
  ).toThrow('ZETTLE_CURSOR_STALLED')
  expect(() =>
    mapZettlePage({ purchases: [base, base], lastPurchaseHash: 'next' }, null),
  ).toThrow('ZETTLE_DUPLICATE_PURCHASE')
})
it('fixture transport clones data, refuses unknown cursor and honors abort without network', async () => {
  const transport = fixtureZettleTransport([
    { cursor: null, response: { purchases: [base], lastPurchaseHash: 'next' } },
  ])
  const signal = new AbortController().signal
  const first = await transport.fetchPage({ cursor: null, signal })
  expect(first).toEqual(await transport.fetchPage({ cursor: null, signal }))
  expect(first).not.toBe(await transport.fetchPage({ cursor: null, signal }))
  await expect(
    transport.fetchPage({ cursor: 'unknown', signal }),
  ).rejects.toThrow('ZETTLE_FIXTURE_CURSOR_UNKNOWN')
  await expect(
    transport.fetchPage({ cursor: null, signal: AbortSignal.abort() }),
  ).rejects.toThrow()
})

it('test transport cannot be enabled against hosted data', async () => {
  const { zettleFixturesEnabled } =
    await import('../../extensions/zettle/fixtures')
  const env = {
    KOMISIO_ZETTLE_FIXTURES: 'true',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  }
  expect(zettleFixturesEnabled(env)).toBe(true)
  expect(
    zettleFixturesEnabled({
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    }),
  ).toBe(false)
  expect(
    zettleFixturesEnabled({
      ...env,
      NEXT_PUBLIC_APP_URL: 'https://komisio-staging.vercel.app',
    }),
  ).toBe(false)
  expect(
    zettleFixturesEnabled({ ...env, KOMISIO_ZETTLE_FIXTURES: 'false' }),
  ).toBe(false)
})
