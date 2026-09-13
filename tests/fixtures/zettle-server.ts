// Local API simulator. It is test infrastructure, not a checkout feature in Komisio.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')
  throw new Error('Local Supabase required')
type Product = {
  uuid: string
  name: string
  externalReference: string
  vatPercentage: number
  variants: {
    uuid: string
    sku: string
    barcode: string
    price: { amount: number; currencyId: string }
  }[]
}
const stores = new Map<
  string,
  {
    products: Map<string, { body: Product; etag: number }>
    purchases: unknown[]
  }
>()
const server = createServer(async (req, res) => {
  const reply = (
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:3456')
    if (url.pathname === '/health') return reply(200, { localFixture: true })
    const org = req.headers.authorization?.match(
      /^Bearer fixture:([0-9a-f-]{36})$/,
    )?.[1]
    if (!org) return reply(401)
    let store = stores.get(org)
    if (!store) {
      store = { products: new Map(), purchases: [] }
      stores.set(org, store)
    }
    let body: unknown
    if (req.method === 'POST' || req.method === 'PUT') {
      const parts: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 1048576) return reply(413)
        parts.push(chunk)
      }
      body = JSON.parse(Buffer.concat(parts).toString() || '{}')
    }
    if (url.pathname === '/oauth.zettle.com/users/self')
      return reply(200, { uuid: org, organizationUuid: org })
    if (url.pathname === '/_test/products')
      return reply(
        200,
        [...store.products.values()].map((p) => p.body),
      )
    if (url.pathname === '/_test/sell' && req.method === 'POST') {
      const ids = (body as { ids: string[] }).ids
      if (!Array.isArray(ids) || !ids.length || ids.length > 50)
        return reply(400)
      const products = ids.map((id) => store!.products.get(id)?.body)
      if (products.some((p) => !p)) return reply(400)
      const purchase = {
        purchaseUUID1: randomUUID(),
        timestamp: '2026-09-13T10:00:00.000+0000',
        currency: 'SEK',
        source: 'POS',
        amount: products.reduce((n, p) => n + p!.variants[0].price.amount, 0),
        products: products.map((p) => ({
          productUuid: p!.uuid,
          variantUuid: p!.variants[0].uuid,
          name: p!.name,
          type: 'PRODUCT',
          quantity: '1',
          unitPrice: p!.variants[0].price.amount,
          sku: p!.variants[0].sku,
          barcode: p!.variants[0].barcode,
        })),
      }
      store.purchases.push(purchase)
      return reply(201, purchase)
    }
    if (
      url.pathname === '/purchase.izettle.com/purchases/v2' &&
      req.method === 'GET'
    ) {
      if (
        !url.searchParams.has('startDate') ||
        !url.searchParams.has('endDate') ||
        url.searchParams.get('limit') !== '100'
      )
        return reply(400)
      const offset = Number(url.searchParams.get('lastPurchaseHash') ?? '0')
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > store.purchases.length
      )
        return reply(400)
      const purchases = store.purchases.slice(offset, offset + 100)
      return reply(
        200,
        purchases.length
          ? { purchases, lastPurchaseHash: String(offset + purchases.length) }
          : { purchases: [] },
      )
    }
    const prefix = `/products.izettle.com/organizations/${org}/products`
    if (req.method === 'POST' && url.pathname === prefix) {
      const p = body as Product
      if (
        !p.uuid ||
        !p.name ||
        p.name.length > 256 ||
        typeof p.vatPercentage !== 'number' ||
        !Array.isArray(p.variants) ||
        p.variants.length !== 1 ||
        p.uuid === p.variants[0].uuid ||
        !Number.isSafeInteger(p.variants[0].price.amount) ||
        p.variants[0].price.currencyId !== 'SEK'
      )
        return reply(400)
      if (store.products.has(p.uuid)) return reply(409)
      store.products.set(p.uuid, { body: p, etag: 1 })
      return reply(201, undefined, { ETag: '"1"' })
    }
    const id = url.pathname
        .replace(prefix + '/v2/', prefix + '/')
        .slice(prefix.length + 1),
      record = store.products.get(id)
    if (url.pathname.startsWith(prefix + '/') && req.method === 'GET')
      return record
        ? reply(
            200,
            {
              ...record.body,
              etag: String(record.etag),
              created: '2026-09-13T00:00:00Z',
              updated: '2026-09-13T00:00:00Z',
            },
            { ETag: `"${record.etag}"` },
          )
        : reply(404)
    if (url.pathname.startsWith(prefix + '/v2/') && req.method === 'PUT') {
      if (!record) return reply(404)
      if (req.headers['if-match'] !== `"${record.etag}"`) return reply(412)
      const p = body as Product
      if (p.uuid !== id || p.variants[0].uuid !== record.body.variants[0].uuid)
        return reply(400)
      store.products.set(id, { body: p, etag: record.etag + 1 })
      return reply(204)
    }
    return reply(404)
  } catch {
    return reply(400)
  }
})
server.listen(3456, '127.0.0.1', () =>
  console.log('Local Zettle API simulator: 127.0.0.1:3456'),
)
