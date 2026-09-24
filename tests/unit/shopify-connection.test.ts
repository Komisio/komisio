import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seal, signState } from '../../lib/platform/credentials'
import {
  authorizeUrl,
  exchangeCode,
  readShop,
  shopDomain,
  shopifyEnvironment,
  shopifyIssue,
  verifyCallbackHmac,
} from '../../extensions/shopify/auth'
import {
  checkShopifyConnection,
  completeShopifyConnection,
  shopifyAccessToken,
  startShopifyConnection,
} from '../../lib/engine/shopify-connection'

const tenant = '10000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  SHOPIFY_CLIENT_ID: 'synthetic-client',
  SHOPIFY_CLIENT_SECRET: 'synthetic-secret',
  SHOPIFY_PILOT_TENANT_ID: tenant,
}
const shop = 'komisio-test.myshopify.com'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const shopBody = (myshopifyDomain = shop) =>
  json({
    data: {
      shop: {
        id: 'gid://shopify/Shop/1',
        name: 'Komisio Test',
        myshopifyDomain,
        currencyCode: 'SEK',
        primaryDomain: { host: 'komisio-test.myshopify.com' },
      },
    },
  })
const tokens = () =>
  json({
    access_token: 'shpat_synthetic',
    scope: 'read_orders,write_products',
    expires_in: 86400,
    refresh_token: 'shprt_synthetic',
  })
function signed(params: Record<string, string>) {
  const p = new URLSearchParams(params)
  const message = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  p.set(
    'hmac',
    createHmac('sha256', env.SHOPIFY_CLIENT_SECRET)
      .update(message)
      .digest('hex'),
  )
  return p
}

describe('shopify auth', () => {
  it('accepts only myshopify hosts and builds the authorisation url', () => {
    expect(shopDomain.parse(' Komisio-Test.myshopify.com ')).toBe(shop)
    for (const bad of [
      'evil.com',
      'komisio-test.myshopify.com.evil.com',
      '-x.myshopify.com',
      'https://x.myshopify.com',
    ])
      expect(shopDomain.safeParse(bad).success, bad).toBe(false)
    const url = new URL(
      authorizeUrl(
        shopifyEnvironment(env),
        shop,
        'https://app.komisio.com/api/integrations/shopify/callback',
        'st',
      ),
    )
    expect(url.host).toBe(shop)
    expect(url.searchParams.get('client_id')).toBe('synthetic-client')
    expect(url.searchParams.get('scope')).toBe(
      'read_orders,write_products,write_inventory,read_locations,read_publications,write_publications',
    )
  })
  it('reports host configuration issues and permits other valid tenants', () => {
    expect(shopifyIssue(tenant, {})).toBe('connectionClientMissing')
    expect(shopifyIssue('20000000-0000-4000-8000-000000000002', env)).toBeNull()
    expect(shopifyIssue(tenant, { ...env, SHOPIFY_CLIENT_ID: '' })).toBe(
      'connectionClientMissing',
    )
    expect(shopifyIssue(tenant, { ...env, SHOPIFY_CLIENT_SECRET: '' })).toBe(
      'connectionSecretMissing',
    )
    expect(shopifyIssue(tenant, env)).toBeNull()
  })
  it('verifies the callback hmac in constant time and refuses a tampered query', () => {
    const p = signed({ code: 'abc', shop, state: 'st', timestamp: '1' })
    expect(verifyCallbackHmac(shopifyEnvironment(env), p)).toBe(true)
    p.set('shop', 'other.myshopify.com')
    expect(verifyCallbackHmac(shopifyEnvironment(env), p)).toBe(false)
    expect(
      verifyCallbackHmac(
        shopifyEnvironment(env),
        new URLSearchParams({ code: 'abc' }),
      ),
    ).toBe(false)
  })
  it('exchanges the code at the shop and reads the shop with the token header', async () => {
    const http = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/admin/oauth/access_token')) {
        expect(String(init?.body)).toContain('client_secret=synthetic-secret')
        return tokens()
      }
      expect(u).toBe(`https://${shop}/admin/api/2026-07/graphql.json`)
      expect(
        (init?.headers as Record<string, string>)['X-Shopify-Access-Token'],
      ).toBe('shpat_synthetic')
      return shopBody()
    })
    const t = await exchangeCode(
      shopifyEnvironment(env),
      shop,
      'code',
      http as typeof fetch,
    )
    expect(t.access_token).toBe('shpat_synthetic')
    const info = await readShop(shop, t.access_token, http as typeof fetch)
    expect(info.currencyCode).toBe('SEK')
    await expect(
      exchangeCode(
        shopifyEnvironment(env),
        shop,
        'bad code',
        http as typeof fetch,
      ),
    ).rejects.toThrow('SHOPIFY_AUTH_REQUIRED')
  })
})

describe('shopify connection engine', () => {
  function client(
    rpc: (name: string, args: Record<string, unknown>) => unknown,
  ) {
    return {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
        data: await rpc(name, args),
        error: null,
      })),
    } as unknown as SupabaseClient
  }
  it('starts with a signed state naming the shop and refuses staff', async () => {
    const c = client((name) => (name === 'tenant_role' ? 'owner' : null))
    const { url, state } = await startShopifyConnection(
      c,
      tenant,
      shop,
      'https://app.komisio.com/cb',
      env,
    )
    expect(url).toContain(`https://${shop}/admin/oauth/authorize`)
    expect(state.split('.')).toHaveLength(2)
    const staff = client((name) => (name === 'tenant_role' ? 'staff' : null))
    await expect(
      startShopifyConnection(
        staff,
        tenant,
        shop,
        'https://app.komisio.com/cb',
        env,
      ),
    ).rejects.toThrow('FORBIDDEN')
  })
  it('completes only for the shop named in the state, then seals and stores', async () => {
    const stored: Record<string, unknown>[] = []
    const c = client((name, args) => {
      if (name === 'tenant_role') return 'owner'
      if (name === 'store_shopify_connection') stored.push(args)
      return null
    })
    const state = signState(
      'shopify-connection',
      { tenantId: tenant, shop },
      60,
      env,
    )
    const http = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/admin/oauth/access_token') ? tokens() : shopBody(),
    ) as unknown as typeof fetch
    const params = signed({ code: 'abc', shop, state, timestamp: '1' })
    const r = await completeShopifyConnection(
      c,
      { params, cookieState: state },
      env,
      http,
    )
    expect(r.shopDomain).toBe(shop)
    expect(stored[0]?.p_shop_domain).toBe(shop)
    expect(JSON.stringify(stored[0])).not.toContain('shpat_synthetic')
    const other = signed({
      code: 'abc',
      shop: 'other.myshopify.com',
      state,
      timestamp: '1',
    })
    await expect(
      completeShopifyConnection(
        c,
        { params: other, cookieState: state },
        env,
        http,
      ),
    ).rejects.toThrow('SHOPIFY_WRONG_SHOP')
    await expect(
      completeShopifyConnection(c, { params, cookieState: 'x' }, env, http),
    ).rejects.toThrow('SHOPIFY_STATE_INVALID')
  })
  it('surfaces a durable currency refusal from the database instead of reporting a connection', async () => {
    const c = client((name) =>
      name === 'tenant_role' ? 'owner' : { error: 'CURRENCY_MISMATCH' },
    )
    const state = signState(
      'shopify-connection',
      { tenantId: tenant, shop },
      60,
      env,
    )
    const params = signed({ code: 'abc', shop, state, timestamp: '1' })
    const http = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/admin/oauth/access_token') ? tokens() : shopBody(),
    )
    await expect(
      completeShopifyConnection(c, { params, cookieState: state }, env, http),
    ).rejects.toThrow('CURRENCY_MISMATCH')
  })
  it('opens the token for a check and refuses an expired one', async () => {
    const cipher = seal(
      'shopify-connection',
      { accessToken: 'shpat_synthetic', refreshToken: null },
      env,
    )
    const row = (expiresAt: string | null) => ({
      shopDomain: shop,
      shopName: 'Komisio Test',
      currency: 'SEK',
      cipher,
      scope: '',
      expiresAt,
      revision: '1',
    })
    const checks: unknown[] = []
    const c = client((name, args) => {
      if (name === 'tenant_role') return 'admin'
      if (name === 'read_shopify_connection') return row(null)
      if (name === 'record_shopify_check') checks.push(args)
      return null
    })
    const http = vi.fn(async () => shopBody()) as unknown as typeof fetch
    const r = await checkShopifyConnection(c, tenant, env, http)
    expect(r.shopName).toBe('Komisio Test')
    expect((checks[0] as { p_kind: string }).p_kind).toBe('checked')
    const expired = client((name) =>
      name === 'tenant_role'
        ? 'admin'
        : name === 'read_shopify_connection'
          ? row('2020-01-01T00:00:00Z')
          : null,
    )
    await expect(shopifyAccessToken(expired, tenant, env)).rejects.toThrow(
      'SHOPIFY_AUTH_REQUIRED',
    )
  })
})
