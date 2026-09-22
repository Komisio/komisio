import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal } from '../../lib/platform/credentials'
import {
  saveShopifySettings,
  shopifySetupOptions,
} from '../../lib/engine/shopify-settings'
const tenant = '10000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  SHOPIFY_CLIENT_ID: 'synthetic',
  SHOPIFY_CLIENT_SECRET: 'synthetic',
}
const settings = {
  mode: 'both',
  locationId: 'gid://shopify/Location/1',
  locationName: 'Untrusted name',
  webPublicationId: 'gid://shopify/Publication/1',
  posPublicationId: 'gid://shopify/Publication/2',
}
function setup(role = 'owner') {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'tenant_role') return { data: role, error: null }
    if (name === 'read_shopify_connection')
      return {
        data: {
          shopDomain: 'synthetic.myshopify.com',
          shopName: 'Synthetic',
          currency: 'SEK',
          cipher: seal(
            'shopify-connection',
            { accessToken: 'synthetic', refreshToken: null },
            env,
          ),
          scope: 'read_publications',
          expiresAt: null,
          revision: '1',
        },
        error: null,
      }
    if (name === 'save_shopify_sync_settings')
      return {
        data: { settings: args?.p_settings, revision: '2', locked: false },
        error: null,
      }
    throw Error('Unexpected RPC ' + name)
  })
  const http = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)).query
    return new Response(
      JSON.stringify({
        data: q.includes('locations(')
          ? {
              locations: {
                edges: [
                  {
                    node: {
                      id: settings.locationId,
                      name: 'Real location',
                      isActive: true,
                      fulfillsOnlineOrders: true,
                    },
                  },
                ],
              },
            }
          : {
              publications: {
                nodes: [1, 2].map((n) => ({
                  id: `gid://shopify/Publication/${n}`,
                  catalog: { title: `Channel ${n}` },
                })),
                pageInfo: { hasNextPage: false },
              },
            },
      }),
    )
  })
  const client = { rpc } as unknown as SupabaseClient
  return { rpc, http, client }
}
describe('tenant Shopify setup', () => {
  it('checks membership before reading tokens or contacting Shopify', async () => {
    const s = setup('staff')
    await expect(
      shopifySetupOptions(s.client, tenant, env, s.http),
    ).rejects.toThrow('FORBIDDEN')
    expect(s.http).not.toHaveBeenCalled()
    expect(s.rpc).toHaveBeenCalledTimes(1)
  })
  it('verifies selections against the connected shop and saves its name with expected revision', async () => {
    const s = setup()
    await saveShopifySettings(s.client, tenant, settings, '1', env, s.http)
    expect(s.rpc).toHaveBeenLastCalledWith('save_shopify_sync_settings', {
      p_tenant: tenant,
      p_shop: 'synthetic.myshopify.com',
      p_revision: '1',
      p_settings: { ...settings, locationName: 'Real location' },
    })
  })
  it.each([
    { locationId: 'gid://shopify/Location/9' },
    { posPublicationId: 'gid://shopify/Publication/9' },
  ])('refuses a selection not returned by the shop', async (patch) => {
    const s = setup()
    await expect(
      saveShopifySettings(
        s.client,
        tenant,
        { ...settings, ...patch },
        '1',
        env,
        s.http,
      ),
    ).rejects.toThrow(/SHOPIFY_NO_LOCATION|SHOPIFY_PUBLICATION_INVALID/)
    expect(
      s.rpc.mock.calls.some((c) => c[0] === 'save_shopify_sync_settings'),
    ).toBe(false)
  })
  it('requires distinct publications for both channels before any network call', async () => {
    const s = setup()
    await expect(
      saveShopifySettings(
        s.client,
        tenant,
        { ...settings, posPublicationId: settings.webPublicationId },
        '1',
        env,
        s.http,
      ),
    ).rejects.toThrow()
    expect(s.http).not.toHaveBeenCalled()
  })
})
