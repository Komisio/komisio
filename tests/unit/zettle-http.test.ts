import { expect, it, vi } from 'vitest'
import { zettleHttpClient } from '../../extensions/zettle/http'
import { type CatalogProduct } from '../../extensions/zettle/catalog'
const org = '10000000-0000-4000-8000-000000000001'
const product: CatalogProduct = {
  uuid: '20000000-0000-4000-8000-000000000001',
  name: 'Synthetic jacket',
  externalReference: 'komisio:30000000-0000-4000-8000-000000000001',
  vatPercentage: 0,
  variants: [
    {
      uuid: '40000000-0000-4000-8000-000000000001',
      sku: 'K-item',
      barcode: 'I-12345678',
      price: { amount: 25000, currencyId: 'SEK' },
    },
  ],
}
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers })
function setup(responses: Response[]) {
  const http = vi.fn<typeof fetch>().mockImplementation(async () => {
    const r = responses.shift()
    if (!r) throw new Error('Unexpected request')
    return r
  })
  const client = zettleHttpClient({
    organizationId: org,
    accessToken: async () => 'test-token',
    fetch: http,
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-10-01T00:00:00Z',
  })
  return { client, http }
}
it('creates one product using current official paths and preserves identity on replay', async () => {
  const { client, http } = setup([
    json({ organizationUuid: org }),
    new Response(null, { status: 404 }),
    new Response(null, { status: 201 }),
    json(product),
    json(product),
  ])
  await client.putProduct(product, null)
  await client.putProduct(product, null)
  expect(http.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
    ['https://oauth.zettle.com/users/self', 'GET'],
    [
      `https://products.izettle.com/organizations/self/products/${product.uuid}`,
      'GET',
    ],
    ['https://products.izettle.com/organizations/self/products', 'POST'],
    [
      `https://products.izettle.com/organizations/self/products/${product.uuid}`,
      'GET',
    ],
    [
      `https://products.izettle.com/organizations/self/products/${product.uuid}`,
      'GET',
    ],
  ])
  expect(JSON.parse(String(http.mock.calls[2][1]?.body))).toEqual(product)
  expect(http.mock.calls[2][1]).toMatchObject({
    redirect: 'error',
    cache: 'no-store',
  })
})
it('updates only frozen previous state with quoted If-Match; retry observes desired state', async () => {
  const next = structuredClone(product)
  next.variants[0].price.amount = 24000
  const { client, http } = setup([
    json({ organizationUuid: org }),
    json({ ...product, etag: '7', created: '2026-09-01' }, 200, {
      ETag: '"7"',
    }),
    new Response(null, { status: 204 }),
    json(next),
    json(next),
  ])
  await client.putProduct(next, product)
  await client.putProduct(next, product)
  expect(http.mock.calls[2][0]).toBe(
    `https://products.izettle.com/organizations/self/products/v2/${product.uuid}`,
  )
  expect(http.mock.calls[2][1]).toMatchObject({
    method: 'PUT',
    headers: { 'If-Match': '"7"' },
  })
})
it('wrong merchant is rejected before any product request', async () => {
  const { client, http } = setup([json({ organizationUuid: product.uuid })])
  await expect(client.putProduct(product, null)).rejects.toThrow(
    'ZETTLE_WRONG_MERCHANT',
  )
  expect(http).toHaveBeenCalledTimes(1)
})
it.each([429, 503, 401])('does not blindly retry status %s', async (status) => {
  const { client, http } = setup([
    json({ organizationUuid: org }),
    new Response(null, { status: 404 }),
    new Response(null, { status }),
  ])
  await expect(client.putProduct(product, null)).rejects.toThrow(/ZETTLE_/)
  expect(http).toHaveBeenCalledTimes(3)
})
it('reconciles create conflict against the exact desired payload', async () => {
  const { client } = setup([
    json({ organizationUuid: org }),
    new Response(null, { status: 404 }),
    new Response(null, { status: 409 }),
    json(product),
  ])
  await expect(client.putProduct(product, null)).resolves.toBeUndefined()
})
it('recovers a lost POST acknowledgement without creating a second product', async () => {
  const { client, http } = setup([
    json({ organizationUuid: org }),
    new Response(null, { status: 404 }),
  ])
  await expect(client.putProduct(product, null)).rejects.toThrow(
    'Unexpected request',
  )
  http.mockResolvedValueOnce(json(product))
  await client.putProduct(product, null)
  expect(http.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1)
})
it.each([
  { ...product, name: 'Edited in POS' },
  { ...product, description: 'External description' },
])('never erases an external change', async (remote) => {
  const { client, http } = setup([
    json({ organizationUuid: org }),
    json(remote, 200, { ETag: '"7"' }),
  ])
  await expect(client.putProduct(product, product)).rejects.toThrow(
    'description' in remote
      ? 'ZETTLE_PRODUCT_FIELDS_UNSUPPORTED'
      : 'ZETTLE_REMOTE_CHANGED',
  )
  expect(http).toHaveBeenCalledTimes(2)
})
it('holds optimistic concurrency conflict without unconditional retry', async () => {
  const next = structuredClone(product)
  next.name = 'New name'
  const { client, http } = setup([
    json({ organizationUuid: org }),
    json(product, 200, { ETag: '"7"' }),
    new Response(null, { status: 412 }),
  ])
  await expect(client.putProduct(next, product)).rejects.toThrow(
    'ZETTLE_REMOTE_CHANGED',
  )
  expect(http).toHaveBeenCalledTimes(3)
})
it('does not recreate a previously delivered but missing product', async () => {
  const { client, http } = setup([
    json({ organizationUuid: org }),
    new Response(null, { status: 404 }),
  ])
  await expect(client.putProduct(product, product)).rejects.toThrow(
    'ZETTLE_REMOTE_MISSING',
  )
  expect(http).toHaveBeenCalledTimes(2)
})
it('uses explicit stable purchase window and opaque cursor', async () => {
  const { client, http } = setup([
    json({ organizationUuid: org }),
    json({ purchases: [] }),
  ])
  await client.fetchPage({ cursor: 'a+/b=', signal: AbortSignal.timeout(1000) })
  const u = new URL(String(http.mock.calls[1][0]))
  expect(u.origin + u.pathname).toBe(
    'https://purchase.izettle.com/purchases/v2',
  )
  expect(Object.fromEntries(u.searchParams)).toEqual({
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-10-01T00:00:00Z',
    limit: '100',
    descending: 'false',
    lastPurchaseHash: 'a+/b=',
  })
})
it('bounds provider data and rejects malformed products', async () => {
  const { client } = setup([
    json({ organizationUuid: org }),
    json({ uuid: product.uuid }),
  ])
  await expect(client.putProduct(product, null)).rejects.toThrow()
  const large = setup([
    json({ organizationUuid: org }),
    json({ padding: 'x'.repeat(70000) }),
  ])
  await expect(large.client.putProduct(product, null)).rejects.toThrow()
})

it('a catalog-only client refuses purchase retrieval without sending an unbounded request', async () => {
  const http = vi.fn<typeof fetch>()
  const client = zettleHttpClient({
    organizationId: org,
    accessToken: async () => 'synthetic',
    fetch: http,
  })
  await expect(
    client.fetchPage({ cursor: null, signal: AbortSignal.timeout(1000) }),
  ).rejects.toThrow('ZETTLE_WINDOW_INVALID')
  expect(http).not.toHaveBeenCalled()
})

it.each([
  [403, 'ZETTLE_PRODUCT_ACCESS_DENIED'],
  [400, 'ZETTLE_PRODUCT_REJECTED'],
  [422, 'ZETTLE_PRODUCT_REJECTED'],
] as const)(
  'preserves safe product error for HTTP %s',
  async (status, code) => {
    const { client } = setup([
      json({ organizationUuid: org }),
      new Response(null, { status: 404 }),
      new Response('Private provider body', { status }),
    ])
    await expect(client.putProduct(product, null)).rejects.toThrow(code)
  },
)
it('unsupported fields expose only known schema names, never values or unknown names', async () => {
  const { client } = setup([
    json({ organizationUuid: org }),
    json({
      ...product,
      taxExempt: false,
      'secret-shaped-name': 'sensitive content',
    }),
  ])
  try {
    await client.putProduct(product, null)
    expect.unreachable()
  } catch (e) {
    expect(e).toMatchObject({
      message: 'ZETTLE_PRODUCT_FIELDS_UNSUPPORTED',
      fields: ['taxExempt', 'other'],
    })
    expect(JSON.stringify(e)).not.toContain('sensitive')
    expect(JSON.stringify(e)).not.toContain('secret-shaped-name')
  }
})
