import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { exportZettleItem } from '../../lib/engine/zettle-stock'
import type { Stock } from '../../extensions/zettle/inventory'
const tenant = '10000000-0000-4000-8000-000000000001',
  merchant = '20000000-0000-4000-8000-000000000001',
  item = '30000000-0000-4000-8000-000000000001',
  request = '40000000-0000-4000-8000-000000000001',
  job = '50000000-0000-4000-8000-000000000001'
const env = {
  ZETTLE_PILOT_TENANT_ID: tenant,
  ZETTLE_MERCHANT_ID: merchant,
  ZETTLE_CLIENT_ID: 'synthetic',
  ZETTLE_API_KEY: 'synthetic',
}
const payload = {
  uuid: item,
  name: 'Synthetic jacket',
  externalReference: `komisio:${item}`,
  vatPercentage: 0,
  variants: [
    {
      uuid: job,
      sku: 'synthetic',
      barcode: 'I-30000000',
      price: { amount: 25000, currencyId: 'SEK' },
    },
  ],
}
const locations = { STORE: tenant, SUPPLIER: merchant, SOLD: item, BIN: job }
function setup(
  options: {
    fresh?: boolean
    role?: string
    tracked?: boolean
    stock?: Stock
    changedAt?: number
    claimLost?: boolean
    writeLost?: boolean
    readLost?: boolean
    catalogFailed?: boolean
    finishFailed?: boolean
  } = {},
) {
  let fresh = options.fresh ?? true,
    tracked = options.tracked ?? false,
    balance: Stock = options.stock ?? {
      store: 0,
      sold: 0,
      bin: 0,
      supplier: 0,
    },
    prepares = 0,
    claimLost = options.claimLost,
    finishFailed = options.finishFailed
  const events: string[] = []
  const rpc = vi.fn(async (name: string) => {
    events.push(name)
    if (name === 'tenant_role')
      return { data: options.role ?? 'owner', error: null }
    if (name === 'prepare_zettle_product')
      return {
        data: ++prepares === options.changedAt ? request : job,
        error: null,
      }
    if (name === 'claim_zettle_stock') {
      const data = { id: request, fresh }
      fresh = false
      if (claimLost) {
        claimLost = false
        return { data: null, error: { message: 'uncertain SQL response' } }
      }
      return { data, error: null }
    }
    if (name === 'finish_zettle_product' && finishFailed) {
      finishFailed = false
      return { data: null, error: { message: 'outcome unavailable' } }
    }
    return { data: null, error: null }
  })
  const from = vi.fn((table: string) => {
    const data =
      table === 'zettle_pull_connections'
        ? { merchant_id: merchant }
        : { payload, previous_payload: null }
    const q = {
      select: () => q,
      eq: () => q,
      single: () => q,
      maybeSingle: () => q,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    }
    return q
  })
  const inventory = {
    inventories: vi.fn(async () => locations),
    tracked: vi.fn(async () => tracked),
    enable: vi.fn(async () => {
      events.push('enable')
      tracked = true
    }),
    stock: vi.fn(async () => {
      if (options.readLost) throw new Error('private read failure')
      return { ...balance }
    }),
    initialize: vi.fn(async () => {
      events.push('initialize')
      balance = { store: 1, sold: 0, bin: 0, supplier: -1 }
      if (options.writeLost) throw new Error('private movement failure')
    }),
  }
  const putProduct = vi.fn(async () => {
    events.push('putProduct')
    if (options.catalogFailed) throw new Error('private catalog failure')
  })
  const factory = vi.fn(async () => ({ putProduct, inventory }))
  const client = { rpc, from } as unknown as SupabaseClient
  const run = (id = request) =>
    exportZettleItem(client, tenant, id, item, env, factory)
  return { run, client, rpc, factory, inventory, events }
}
it('commits the sole stock claim before tracking or movement, then records observed stock', async () => {
  const s = setup()
  expect(await s.run()).toEqual({ id: request, stock: 'initialized' })
  expect(s.events.indexOf('claim_zettle_stock')).toBeLessThan(
    s.events.indexOf('enable'),
  )
  expect(s.events.indexOf('claim_zettle_stock')).toBeLessThan(
    s.events.indexOf('initialize'),
  )
  expect(s.inventory.initialize).toHaveBeenCalledTimes(1)
  expect(s.rpc).toHaveBeenLastCalledWith(
    'finish_zettle_stock',
    expect.objectContaining({ p_status: 'initialized', p_error: null }),
  )
  await s.run(merchant)
  expect(s.inventory.initialize).toHaveBeenCalledTimes(1)
})
it('a lost movement response is read back, never retransmitted', async () => {
  const s = setup({ writeLost: true })
  expect((await s.run()).stock).toBe('initialized')
  await s.run()
  expect(s.inventory.initialize).toHaveBeenCalledTimes(1)
})
it('a committed claim with a lost response can only reconcile on replay', async () => {
  const s = setup({ claimLost: true })
  await expect(s.run()).rejects.toThrow()
  expect((await s.run()).stock).toBe('unknown')
  expect(s.inventory.enable).not.toHaveBeenCalled()
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
it('a crash/failure after claiming but before recording the product does not recreate the grant', async () => {
  const s = setup({ finishFailed: true })
  await expect(s.run()).rejects.toThrow()
  expect((await s.run()).stock).toBe('unknown')
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
it('zero stock on replay is held even when tracking is enabled', async () => {
  const s = setup({ fresh: false, tracked: true })
  expect((await s.run()).stock).toBe('unknown')
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
it('externally disabled tracking is not re-enabled on replay', async () => {
  const s = setup({ fresh: false, tracked: false })
  expect((await s.run()).stock).toBe('unknown')
  expect(s.inventory.enable).not.toHaveBeenCalled()
})
it.each([
  { store: 0, sold: 1, bin: 0, supplier: -1 },
  { store: 0, sold: 0, bin: 1, supplier: -1 },
])('depleted stock stays depleted', async (stock) => {
  const s = setup({ fresh: false, tracked: true, stock })
  expect((await s.run()).stock).toBe('depleted')
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
it('nonzero stock on the initial attempt is held rather than attributed to this claim', async () => {
  const s = setup({
    tracked: true,
    stock: { store: 1, sold: 0, bin: 0, supplier: -1 },
  })
  expect((await s.run()).stock).toBe('conflict')
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
it.each([2, 3])(
  'revalidates snapshot before product and inventory writes (check %s)',
  async (changedAt) => {
    const s = setup({ changedAt })
    if (changedAt === 2)
      await expect(s.run()).rejects.toThrow('ZETTLE_CONFIG_CHANGED')
    else expect((await s.run()).stock).toBe('unknown')
    expect(s.inventory.initialize).not.toHaveBeenCalled()
  },
)
it.each(['staff', 'readonly', ''])(
  'denies %s before provider access',
  async (role) => {
    const s = setup({ role })
    await expect(s.run()).rejects.toThrow('FORBIDDEN')
    expect(s.factory).not.toHaveBeenCalled()
  },
)
it('missing merchant pin prevents provider access', async () => {
  const s = setup()
  await expect(
    exportZettleItem(
      s.client,
      tenant,
      request,
      item,
      { ...env, ZETTLE_MERCHANT_ID: undefined },
      s.factory,
    ),
  ).rejects.toThrow('ZETTLE_NOT_CONNECTED')
  expect(s.factory).not.toHaveBeenCalled()
})
it('catalog failure records only a safe code and does not claim inventory', async () => {
  const s = setup({ catalogFailed: true })
  await expect(s.run()).rejects.toThrow(/^ZETTLE_EXPORT_FAILED$/)
  expect(s.events).not.toContain('claim_zettle_stock')
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
it('unreadable stock is held and persisted without raw errors', async () => {
  const s = setup({ readLost: true })
  expect((await s.run()).stock).toBe('unknown')
  expect(s.rpc).toHaveBeenLastCalledWith(
    'finish_zettle_stock',
    expect.objectContaining({ p_error: 'ZETTLE_STOCK_HELD' }),
  )
  expect(s.inventory.initialize).not.toHaveBeenCalled()
})
