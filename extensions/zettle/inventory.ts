import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'
export type InventoryIds = {
  STORE: string
  SUPPLIER: string
  SOLD: string
  BIN: string
}
export type Stock = { store: number }
export function stockOutcome(
  stock: Stock,
): 'initialized' | 'unknown' | 'conflict' {
  if (stock.store === 1) return 'initialized'
  if (stock.store === 0) return 'unknown'
  return 'conflict'
}
export function mayInitialize(stock: Stock) {
  return stock.store === 0
}
export interface ZettleInventory {
  inventories(): Promise<InventoryIds>
  tracked(product: string): Promise<boolean>
  enable(product: string): Promise<void>
  stock(product: string, variant: string, ids: InventoryIds): Promise<Stock>
  initialize(
    product: string,
    variant: string,
    ids: InventoryIds,
    intentId: string,
  ): Promise<void>
}
/** Fixed official hosts only. The host supplies a merchant-verified private token lease. */
export function inventoryHttpClient(
  org: string,
  token: () => Promise<string>,
  http: typeof fetch = globalThis.fetch,
): ZettleInventory {
  z.uuid().parse(org)
  async function call(path: string, method = 'GET', body?: unknown) {
    const access = await token()
    if (!access || /[\r\n]/.test(access))
      throw new Error('ZETTLE_AUTH_REQUIRED')
    const r = await http('https://inventory.izettle.com/v3' + path, {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      throw new Error('ZETTLE_INVENTORY_FAILED')
    })
    if ([401, 403].includes(r.status))
      throw new InventoryReadError(r.status, [])
    if (r.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
    if (!r.ok) throw new InventoryReadError(r.status, [])
    // Do not follow an untrusted pagination URL or silently use a partial inventory list.
    if (r.headers.get('link')) throw new Error('ZETTLE_INVENTORY_AMBIGUOUS')
    return r
  }
  return {
    async inventories() {
      const r = await call('/inventories')
      const rows = z
        .array(
          z.object({
            inventoryUuid: z.uuid(),
            inventoryType: z.enum(['STORE', 'SUPPLIER', 'SOLD', 'BIN']),
          }),
        )
        .max(100)
        .parse(await boundedJson(r, 65536))
      const ids = {} as InventoryIds
      for (const type of ['STORE', 'SUPPLIER', 'SOLD', 'BIN'] as const) {
        const matches = rows.filter((r) => r.inventoryType === type)
        if (matches.length !== 1) throw new Error('ZETTLE_INVENTORY_AMBIGUOUS')
        ids[type] = matches[0].inventoryUuid
      }
      if (new Set(Object.values(ids)).size !== 4)
        throw new Error('ZETTLE_INVENTORY_AMBIGUOUS')
      return ids
    },
    async tracked(product) {
      z.uuid().parse(product)
      const r = await call('/products/status', 'POST', [product])
      const rows = parseInventory(
        z
          .array(z.object({ productUuid: z.uuid(), enabled: z.boolean() }))
          .max(1),
        await boundedJson(r, 8192),
      )
      if (rows[0] && rows[0].productUuid !== product)
        throw new Error('ZETTLE_INVENTORY_CONFLICT')
      return rows[0]?.enabled ?? false
    },
    async enable(product) {
      z.uuid().parse(product)
      const r = await call('/products', 'POST', [
        { productUuid: product, tracking: 'enable' },
      ])
      if (r.status !== 204) throw new Error('ZETTLE_INVENTORY_FAILED')
    },
    async stock(product, variant, ids) {
      z.uuid().parse(product)
      z.uuid().parse(variant)
      z.uuid().parse(ids.STORE)
      const r = await call(`/stock/${ids.STORE}/products/${product}`)
      const schema = z
        .array(
          z.object({
            organizationUuid: z.uuid(),
            inventoryUuid: z.uuid(),
            productUuid: z.uuid(),
            variantUuid: z.uuid(),
            balance: z.number().int().min(-1000000).max(1000000),
          }),
        )
        .max(1)
      const rows = parseInventory(schema, await boundedJson(r, 8192))
      if (
        rows.some(
          (r) =>
            r.organizationUuid !== org ||
            r.inventoryUuid !== ids.STORE ||
            r.productUuid !== product ||
            r.variantUuid !== variant,
        )
      )
        throw new Error('ZETTLE_INVENTORY_CONFLICT')
      return { store: rows[0]?.balance ?? 0 }
    },
    async initialize(product, variant, ids, intentId) {
      for (const value of [product, variant, ids.SUPPLIER, ids.STORE, intentId])
        z.uuid().parse(value)
      const r = await call('/movements', 'POST', {
        identifier: intentId,
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
      if (r.status !== 204) throw new Error('ZETTLE_INVENTORY_FAILED')
    },
  }
}

/** Safe diagnostics contain HTTP status and known schema names, never provider values. */
export class InventoryReadError extends Error {
  readonly fields: string[]
  constructor(
    readonly httpStatus: number,
    fields: string[],
  ) {
    super(
      [401, 403].includes(httpStatus)
        ? 'ZETTLE_AUTH_REQUIRED'
        : 'ZETTLE_INVENTORY_FAILED',
    )
    const known = new Set([
      'productUuid',
      'variantUuid',
      'inventoryUuid',
      'organizationUuid',
      'enabled',
      'balance',
    ])
    this.fields = [
      ...new Set(fields.map((f) => (known.has(f) ? f : 'other'))),
    ].slice(0, 8)
  }
}
function parseInventory<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw new InventoryReadError(
      200,
      parsed.error.issues.flatMap((i) =>
        i.path.filter((p): p is string => typeof p === 'string'),
      ),
    )
  return parsed.data
}
