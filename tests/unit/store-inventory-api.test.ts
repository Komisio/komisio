import { describe, expect, it, vi } from 'vitest'
import spec from '../../lib/engine/store-api-openapi-base.json'
import { storeApiResponse } from '@/lib/http/store-inventory-api'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/engine/connectors', () => ({ anonClient: () => ({ rpc }) }))
const storeInventoryResponse = (r: Request, id?: string) =>
  storeApiResponse(r, id ? ['items', id] : ['items'])
const key = 'kmi_' + 'a'.repeat(64)
const id = '10000000-0000-4000-8000-000000000001'
const row = {
  id,
  title: 'Jacket',
  category: null,
  stage: 'on_sale',
  priceMinor: 50000,
  currency: 'SEK',
}
const req = (q = '') =>
  new Request('https://example.test/api/public/v1/items' + q, {
    headers: { Authorization: 'Bearer ' + key },
  })
describe('Store inventory HTTP contract', () => {
  it('projects only documented fields and binds paging to the bearer credential', async () => {
    rpc.mockResolvedValueOnce({
      data: { items: [{ ...row, sellerId: 'private' }], nextCursor: id },
    })
    const r = await storeInventoryResponse(req('?limit=1&after=' + id))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ items: [row], nextCursor: id })
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(rpc).toHaveBeenCalledWith('read_store_inventory', {
      p_secret: key,
      p_item: null,
      p_limit: 1,
      p_after: id,
    })
    expect(Object.keys(row).sort()).toEqual(
      [...spec.components.schemas.Item.required].sort(),
    )
  })
  it.each([
    ['executed', 200],
    ['failed', 422],
    ['review', 202],
  ] as const)('reports the %s write outcome', async (status, httpStatus) => {
    const result =
      status === 'review'
        ? { id, status }
        : {
            id,
            action: 'createSeller',
            status,
            resultId: status === 'executed' ? id : null,
            error: status === 'failed' ? 'INVALID_INPUT' : null,
          }
    rpc.mockResolvedValueOnce({ data: result })
    const r = await storeApiResponse(
      new Request('https://example.test/api/public/v1/sellers', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Idempotency-Key': id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Example seller', phone: '0700000000' }),
      }),
      ['sellers'],
    )
    expect(r.status).toBe(httpStatus)
    const statusUrl = '/api/public/v1/requests/' + id
    expect(await r.json()).toEqual(
      status === 'review' ? { id, statusUrl } : { ...result, statusUrl },
    )
    expect(r.headers.get('location')).toBe(statusUrl)
  })
  it('requires a key and rejects unsupported parameters', async () => {
    expect(
      (await storeInventoryResponse(new Request('https://example.test')))
        .status,
    ).toBe(401)
    for (const q of [
      '?limit=1&limit=2',
      '?after=bad',
      '?limit=0',
      '?tenantId=' + id,
    ])
      expect((await storeInventoryResponse(req(q))).status).toBe(400)
  })
  it('handles the item route, unknown IDs, throttling and database errors', async () => {
    rpc.mockResolvedValueOnce({ data: { items: [row], nextCursor: null } })
    expect(await (await storeInventoryResponse(req(), id)).json()).toEqual(row)
    rpc.mockResolvedValueOnce({ data: { items: [], nextCursor: null } })
    expect((await storeInventoryResponse(req(), id)).status).toBe(404)
    for (const [message, status] of [
      ['INVALID_KEY', 401],
      ['RATE_LIMIT', 429],
      ['private database failure', 503],
    ] as const) {
      rpc.mockResolvedValueOnce({ error: { message } })
      const r = await storeInventoryResponse(req())
      expect(r.status).toBe(status)
      if (status === 429) expect(r.headers.get('Retry-After')).toBe('60')
      expect(await r.text()).not.toContain('private database failure')
    }
  })
})
