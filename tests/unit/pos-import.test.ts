import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runPosImport } from '../../lib/engine/pos-import'
import { seal } from '../../lib/platform/credentials'
import { paypalEnvironment } from '../../lib/engine/paypal-credentials'
import { paypalCatalogItem } from '../../extensions/pos-catalog'

vi.mock('../../lib/engine/paypal-credentials', () => ({
  paypalEnvironment: vi.fn(),
}))
vi.mock('../../lib/engine/shopify-connection', () => ({
  shopifyAccessToken: vi.fn(),
}))
vi.mock('../../extensions/pos-catalog', () => ({
  paypalCatalog: vi.fn(),
  shopifyCatalog: vi.fn(),
  paypalCatalogItem: vi.fn(),
  shopifyCatalogItem: vi.fn(),
}))
const tenantId = '10000000-0000-4000-8000-000000000001',
  actorId = '20000000-0000-4000-8000-000000000001',
  itemId = '30000000-0000-4000-8000-000000000001',
  account = '40000000-0000-4000-8000-000000000001',
  requestId = '50000000-0000-4000-8000-000000000001'
const env = { KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32) }
const product = {
  productId: itemId,
  variantId: requestId,
  title: 'Synthetic',
  sku: 'OLD-1',
  barcode: '0012345',
  priceOre: 10000,
  currency: 'SEK',
  quantity: null,
  active: true,
}
const item = {
  id: itemId,
  title: 'Synthetic',
  reference: 'I-30000000',
  ownership: 'store',
  seller: null,
  priceOre: 10000,
}
const result = { requestId, item, created: false }
function command(over = {}, expiry = Date.now() + 60000) {
  return {
    action: 'commit',
    tenantId,
    requestId,
    token: JSON.stringify(
      seal(
        'pos-import-review-v1',
        {
          tenantId,
          actorId,
          provider: 'paypal',
          account,
          product,
          expires: expiry,
        },
        env,
      ),
    ),
    mode: 'link',
    itemId,
    sellerId: null,
    context: null,
    received: false,
    ...over,
  }
}
function client(replay: unknown = null, role = 'owner') {
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'tenant_role'
        ? role
        : name === 'pos_import_result'
          ? replay
          : result,
  }))
  return { rpc, db: { rpc } as unknown as SupabaseClient }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(paypalEnvironment).mockResolvedValue({
    ZETTLE_MERCHANT_ID: account,
    ZETTLE_ACCESS_TOKEN: 'synthetic',
  })
  vi.mocked(paypalCatalogItem).mockResolvedValue(product)
})
describe('POS import review boundary', () => {
  it('rejects staff, altered tokens, another actor and expired uncommitted reviews', async () => {
    await expect(
      runPosImport(client(null, 'staff').db, actorId, command(), env),
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      runPosImport(client().db, actorId, command({ token: '{}' }), env),
    ).rejects.toThrow('POS_REVIEW_EXPIRED')
    await expect(
      runPosImport(client().db, itemId, command(), env),
    ).rejects.toThrow('POS_REVIEW_EXPIRED')
    await expect(
      runPosImport(client().db, actorId, command({}, 1), env),
    ).rejects.toThrow('POS_REVIEW_EXPIRED')
    expect(paypalCatalogItem).not.toHaveBeenCalled()
  })
  it('requires unchanged source facts and account before committing', async () => {
    const c = client()
    vi.mocked(paypalCatalogItem).mockResolvedValue({
      ...product,
      priceOre: 20000,
    })
    await expect(runPosImport(c.db, actorId, command(), env)).rejects.toThrow(
      'POS_REVIEW_EXPIRED',
    )
    expect(c.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'commit_pos_import',
    )
    vi.mocked(paypalEnvironment).mockResolvedValue({
      ZETTLE_MERCHANT_ID: itemId,
      ZETTLE_ACCESS_TOKEN: 'synthetic',
    })
    await expect(runPosImport(c.db, actorId, command(), env)).rejects.toThrow(
      'POS_CONNECTION_CHANGED',
    )
  })
  it('commits only the verified snapshot and returns the matching request', async () => {
    const c = client()
    await expect(runPosImport(c.db, actorId, command(), env)).resolves.toEqual(
      result,
    )
    expect(c.rpc).toHaveBeenLastCalledWith(
      'commit_pos_import',
      expect.objectContaining({
        p_product: product,
        p_account: account,
        p_item: itemId,
        p_request: requestId,
      }),
    )
  })
  it('recovers a committed request even after expiry or a later POS sale', async () => {
    const input = {
      provider: 'paypal',
      account,
      product,
      mode: 'link',
      item: itemId,
      seller: null,
      context: null,
      received: false,
    }
    await expect(
      runPosImport(client({ input, result }).db, actorId, command({}, 1), env),
    ).resolves.toEqual(result)
    expect(paypalCatalogItem).not.toHaveBeenCalled()
    await expect(
      runPosImport(
        client({ input, result }).db,
        actorId,
        command({ itemId: actorId }),
        env,
      ),
    ).rejects.toThrow('REQUEST_CONFLICT')
  })
})
