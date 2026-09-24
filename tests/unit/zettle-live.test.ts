import { mapZettlePage } from '../../extensions/zettle/purchase'
import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pullZettlePurchases } from '../../lib/engine/zettle-live'
const tenant = '10000000-0000-4000-8000-000000000001',
  merchant = '20000000-0000-4000-8000-000000000001',
  id = '30000000-0000-4000-8000-000000000001',
  windowId = '40000000-0000-4000-8000-000000000001'
const env = {
  ZETTLE_PILOT_TENANT_ID: tenant,
  ZETTLE_MERCHANT_ID: merchant,
  ZETTLE_CLIENT_ID: 'opaque-client',
  ZETTLE_API_KEY: 'synthetic-only',
}
function setup(
  role = 'owner',
  prior = false,
  opened: string | null = windowId,
) {
  let pageReads = 0,
    windowReads = 0
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'tenant_role'
        ? role
        : name === 'store_currency'
          ? 'SEK'
          : name === 'open_zettle_pull_window'
            ? opened
            : id,
    error: null,
  }))
  const from = vi.fn((table: string) => {
    let data: unknown
    if (table === 'zettle_pull_connections')
      data = { merchant_id: merchant, cutover: '2026-01-01T00:00:00Z' }
    if (table === 'zettle_pull_windows')
      data =
        ++windowReads === 1
          ? []
          : { start_at: '2026-01-01T00:00:00Z', end_at: '2026-01-02T00:00:00Z' }
    if (table === 'zettle_pull_pages')
      data =
        ++pageReads === 1
          ? prior
            ? { window_id: windowId, cursor_before: null, cursor_after: null }
            : null
          : []
    if (table === 'zettle_sync_runs') data = { page: [] }
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => q,
      single: () => q,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    }
    return q
  })
  const fetchPage = vi.fn().mockResolvedValue({ purchases: [] }),
    factory = vi.fn().mockResolvedValue({ fetchPage })
  return {
    client: { rpc, from } as unknown as SupabaseClient,
    rpc,
    from,
    factory,
    fetchPage,
  }
}
it.each(['staff', 'readonly', ''])(
  'denies role %s before reading transport state or credentials',
  async (role) => {
    const s = setup(role)
    await expect(
      pullZettlePurchases(s.client, tenant, id, env, s.factory),
    ).rejects.toThrow('FORBIDDEN')
    expect(s.from).not.toHaveBeenCalled()
    expect(s.factory).not.toHaveBeenCalled()
  },
)
it('waits through the initial lag without calling Zettle', async () => {
  const s = setup('owner', false, null)
  expect(
    await pullZettlePurchases(s.client, tenant, id, env, s.factory),
  ).toEqual({ id, waiting: true })
  expect(s.factory).not.toHaveBeenCalled()
})
it('binds the provider interval to stored state and commits an empty completion page', async () => {
  const s = setup()
  expect(
    await pullZettlePurchases(s.client, tenant, id, env, s.factory),
  ).toEqual({ id, received: 0, complete: true })
  expect(s.factory).toHaveBeenCalledWith(tenant, env, {
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-02T00:00:00.000Z',
  })
  expect(s.rpc).toHaveBeenLastCalledWith('record_zettle_pull_page', {
    p_tenant: tenant,
    p_id: id,
    p_window: windowId,
    p_before: null,
    p_after: null,
    p_purchases: [],
  })
})
it('replays a stored page through SQL identity checks without fetching the provider again', async () => {
  const s = setup('owner', true)
  expect(
    await pullZettlePurchases(s.client, tenant, id, env, s.factory),
  ).toEqual({ id, replayed: true })
  expect(s.factory).not.toHaveBeenCalled()
  expect(s.rpc).toHaveBeenLastCalledWith(
    'record_zettle_pull_page',
    expect.objectContaining({ p_id: id, p_window: windowId, p_purchases: [] }),
  )
})
it('denies a changed pinned merchant before any provider request', async () => {
  const s = setup()
  await expect(
    pullZettlePurchases(
      s.client,
      tenant,
      id,
      { ...env, ZETTLE_MERCHANT_ID: tenant },
      s.factory,
    ),
  ).rejects.toThrow('ZETTLE_NOT_CONNECTED')
  expect(s.factory).not.toHaveBeenCalled()
})

it.each([undefined, null, ''])(
  'accepts an empty terminal page without a usable hash: %s',
  (hash) => {
    expect(
      mapZettlePage(
        { purchases: [], lastPurchaseHash: hash },
        'previous',
        'SEK',
      ),
    ).toEqual({ purchases: [], nextCursor: 'previous' })
  },
)
