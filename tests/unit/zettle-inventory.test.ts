import { expect, it, vi } from 'vitest'
import {
  inventoryHttpClient,
  mayInitialize,
  stockOutcome,
  type Stock,
  type InventoryIds,
} from '../../extensions/zettle/inventory'
const org = '10000000-0000-4000-8000-000000000001'
const product = '20000000-0000-4000-8000-000000000001'
const variant = '30000000-0000-4000-8000-000000000001'
const intent = '40000000-0000-4000-8000-000000000001'
const ids: InventoryIds = {
  STORE: '50000000-0000-4000-8000-000000000001',
  SUPPLIER: '50000000-0000-4000-8000-000000000002',
  SOLD: '50000000-0000-4000-8000-000000000003',
  BIN: '50000000-0000-4000-8000-000000000004',
}
const json = (body: unknown, headers = {}) =>
  new Response(JSON.stringify(body), { headers })
const inventories = Object.entries(ids).map(
  ([inventoryType, inventoryUuid]) => ({ inventoryType, inventoryUuid }),
)
function setup(responses: (Response | Error)[]) {
  const http = vi.fn<typeof fetch>().mockImplementation(async () => {
    const r = responses.shift()
    if (!r) throw new Error('Unexpected request')
    if (r instanceof Error) throw r
    return r
  })
  return {
    client: inventoryHttpClient(org, async () => 'synthetic-token', http),
    http,
  }
}
it.each<[Stock, string, boolean]>([
  [{ store: 0, sold: 0, bin: 0, supplier: 0 }, 'unknown', true],
  [{ store: 1, sold: 0, bin: 0, supplier: -1 }, 'initialized', false],
  [{ store: 0, sold: 1, bin: 0, supplier: -1 }, 'depleted', false],
  [{ store: 0, sold: 0, bin: 1, supplier: -1 }, 'depleted', false],
  [{ store: 0, sold: 0, bin: 0, supplier: -1 }, 'conflict', false],
  [{ store: 1, sold: 0, bin: 0, supplier: 0 }, 'conflict', false],
  [{ store: 0, sold: 1, bin: 0, supplier: -2 }, 'conflict', false],
  [{ store: 2, sold: 0, bin: 0, supplier: -2 }, 'conflict', false],
  [{ store: 1, sold: 1, bin: 0, supplier: -2 }, 'conflict', false],
  [{ store: -1, sold: 2, bin: 0, supplier: -1 }, 'conflict', false],
])(
  'classifies stock %j without suggesting restock',
  (stock, outcome, initial) => {
    expect(stockOutcome(stock)).toBe(outcome)
    expect(mayInitialize(stock)).toBe(initial)
  },
)
it('discovers exactly four distinct inventory roles using the fixed host', async () => {
  const { client, http } = setup([json(inventories)])
  expect(await client.inventories()).toEqual(ids)
  expect(http).toHaveBeenCalledWith(
    'https://inventory.izettle.com/v3/inventories',
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: expect.objectContaining({
        Authorization: 'Bearer synthetic-token',
      }),
    }),
  )
})
it.each(
  [
    inventories.slice(1),
    [...inventories, { inventoryType: 'STORE', inventoryUuid: org }],
    inventories.map((r) => ({ ...r, inventoryUuid: org })),
  ].map((rows) => ({ rows })),
)(
  'holds missing, duplicate roles or shared inventory IDs',
  async ({ rows }) => {
    const { client } = setup([json(rows)])
    await expect(client.inventories()).rejects.toThrow(
      'ZETTLE_INVENTORY_AMBIGUOUS',
    )
  },
)
it('holds pagination instead of following an arbitrary URL or choosing a partial result', async () => {
  const { client, http } = setup([
    json(inventories, { Link: '<https://other.example>; rel="next"' }),
  ])
  await expect(client.inventories()).rejects.toThrow(
    'ZETTLE_INVENTORY_AMBIGUOUS',
  )
  expect(http).toHaveBeenCalledTimes(1)
})
it('reads tracking and enables only the specified product', async () => {
  const { client, http } = setup([
    json([{ productUuid: product, enabled: false }]),
    new Response(null, { status: 204 }),
  ])
  expect(await client.tracked(product)).toBe(false)
  await client.enable(product)
  expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toEqual([product])
  expect(JSON.parse(String(http.mock.calls[1][1]?.body))).toEqual([
    { productUuid: product, tracking: 'enable' },
  ])
})
it('rejects tracking evidence for another product', async () => {
  const { client } = setup([json([{ productUuid: variant, enabled: true }])])
  await expect(client.tracked(product)).rejects.toThrow(
    'ZETTLE_INVENTORY_CONFLICT',
  )
})
it('reads every inventory and verifies merchant, inventory, product and variant', async () => {
  const { client } = setup(
    (['STORE', 'SOLD', 'BIN', 'SUPPLIER'] as const).map((type) =>
      json([
        {
          organizationUuid: org,
          inventoryUuid: ids[type],
          productUuid: product,
          variantUuid: variant,
          balance: type === 'STORE' ? 1 : type === 'SUPPLIER' ? -1 : 0,
        },
      ]),
    ),
  )
  expect(await client.stock(product, variant, ids)).toEqual({
    store: 1,
    sold: 0,
    bin: 0,
    supplier: -1,
  })
})
it.each(['organizationUuid', 'inventoryUuid', 'productUuid', 'variantUuid'])(
  'refuses mismatched %s in stock evidence',
  async (field) => {
    const { client } = setup([
      json([
        {
          organizationUuid: org,
          inventoryUuid: ids.STORE,
          productUuid: product,
          variantUuid: variant,
          balance: 1,
          [field]: intent,
        },
      ]),
    ])
    await expect(client.stock(product, variant, ids)).rejects.toThrow(
      'ZETTLE_INVENTORY_CONFLICT',
    )
  },
)
it('treats missing stock rows as zero, not evidence of a successful movement', async () => {
  const { client } = setup([json([]), json([]), json([]), json([])])
  expect(stockOutcome(await client.stock(product, variant, ids))).toBe(
    'unknown',
  )
})
it.each([0.5, '1', null])('rejects unsupported balance %j', async (balance) => {
  const { client } = setup([
    json([
      {
        organizationUuid: org,
        inventoryUuid: ids.STORE,
        productUuid: product,
        variantUuid: variant,
        balance,
      },
    ]),
  ])
  await expect(client.stock(product, variant, ids)).rejects.toThrow()
})
it('sends exactly one unit with an intent correlation, without transport retries', async () => {
  const { client, http } = setup([new Response(null, { status: 204 })])
  await client.initialize(product, variant, ids, intent)
  expect(http).toHaveBeenCalledTimes(1)
  expect(http.mock.calls[0][0]).toBe(
    'https://inventory.izettle.com/v3/movements',
  )
  expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toEqual({
    identifier: intent,
    movements: [
      {
        productUuid: product,
        variantUuid: variant,
        change: 1,
        from: ids.SUPPLIER,
        to: ids.STORE,
      },
    ],
  })
})
it('does not retry an uncertain write or expose raw transport errors', async () => {
  const { client, http } = setup([new Error('sensitive upstream detail')])
  await expect(
    client.initialize(product, variant, ids, intent),
  ).rejects.toThrow(/^ZETTLE_INVENTORY_FAILED$/)
  expect(http).toHaveBeenCalledTimes(1)
})
it.each([
  [401, 'ZETTLE_AUTH_REQUIRED'],
  [403, 'ZETTLE_AUTH_REQUIRED'],
  [429, 'ZETTLE_RATE_LIMITED'],
  [500, 'ZETTLE_INVENTORY_FAILED'],
] as const)('maps HTTP %s to a safe error', async (status, code) => {
  const { client } = setup([
    new Response('private provider detail', { status }),
  ])
  await expect(client.inventories()).rejects.toThrow(code)
})
it('rejects malformed IDs before a network request', async () => {
  const { client, http } = setup([])
  await expect(client.enable('../elsewhere')).rejects.toThrow()
  expect(http).not.toHaveBeenCalled()
})
