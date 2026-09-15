import { describe, expect, it, vi } from 'vitest'
import type { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  handleShopifyCron,
  readShopifyAutomaticStatus,
  runAutomaticShopifyPull,
} from '../../lib/engine/shopify-automation'
import { seal } from '../../lib/platform/credentials'

const tenantId = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const runId = '01234567-89ab-cdef-0123-456789abcdef'
const env = {
  KOMISIO_INTAKE_ENABLED: 'true',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'password-long-enough',
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  CRON_SECRET: 'cron-secret-long-enough',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
  SHOPIFY_PILOT_TENANT_ID: tenantId,
  SHOPIFY_CLIENT_ID: 'synthetic-client',
  SHOPIFY_CLIENT_SECRET: 'synthetic-secret',
}
const since = '2026-09-15T10:00:00Z'
const request = () =>
  new Request('https://example.test/api/automation/shopify-pull', {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  })

function runFixture(
  options: { orders?: number; prepared?: boolean; fail?: boolean } = {},
) {
  const cipher = seal(
    'shopify-connection',
    { accessToken: 'shpat_synthetic', refreshToken: null },
    env,
  )
  const calls: [string, Record<string, unknown>][] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args])
    if (name === 'prepare_shopify_automatic_pull')
      return {
        data: options.prepared === false ? null : { id: runId, cursor: since },
        error: null,
      }
    if (name === 'tenant_role') return { data: 'automation', error: null }
    if (name === 'read_shopify_connection')
      return {
        data: {
          shopDomain: 'komisio-test.myshopify.com',
          shopName: 'Komisio Test',
          currency: 'SEK',
          cipher,
          scope: 'read_orders',
          expiresAt: null,
          revision: '1',
        },
        error: null,
      }
    if (name === 'shopify_order_cursor') return { data: since, error: null }
    if (name === 'record_shopify_order_page')
      return { data: args.p_id, error: null }
    if (name === 'finish_shopify_automatic_pull')
      return { data: null, error: null }
    return { data: null, error: { message: `UNEXPECTED_${name}` } }
  })
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  }))
  const http = vi.fn(async () => {
    if (options.fail) throw new TypeError('private-provider-body')
    const nodes = Array.from({ length: options.orders ?? 0 }, (_, i) => ({
      id: `gid://shopify/Order/${i + 1}`,
      name: `#${1000 + i}`,
      createdAt: '2026-09-15T11:00:00Z',
      updatedAt: '2026-09-15T11:05:00Z',
      displayFinancialStatus: 'PAID',
      test: false,
      cancelledAt: null,
      lineItems: {
        nodes: [
          {
            sku: 'K-30000000-0000-4000-8000-000000000001',
            title: 'Jacket',
            quantity: 1,
            discountedTotalSet: {
              shopMoney: { amount: '250.00', currencyCode: 'SEK' },
            },
          },
        ],
      },
    }))
    return new Response(JSON.stringify({ data: { orders: { nodes } } }), {
      status: 200,
    })
  })
  const client = { rpc, from } as unknown as SupabaseClient
  return { client, rpc, calls, http }
}

describe('automatic Shopify pull', () => {
  it('pulls one page under the reserved run id and records the received outcome', async () => {
    const f = runFixture({ orders: 2 })
    await runAutomaticShopifyPull(
      f.client,
      tenantId,
      env,
      f.http as unknown as typeof fetch,
    )
    const page = f.calls.find(([n]) => n === 'record_shopify_order_page')!
    expect(page[1]).toMatchObject({
      p_tenant: tenantId,
      p_id: runId,
      p_before: since,
    })
    expect(f.rpc).toHaveBeenCalledWith('finish_shopify_automatic_pull', {
      p_tenant: tenantId,
      p_id: runId,
      p_outcome: 'received',
    })
  })
  it('records complete for an empty page', async () => {
    const f = runFixture({ orders: 0 })
    await runAutomaticShopifyPull(
      f.client,
      tenantId,
      env,
      f.http as unknown as typeof fetch,
    )
    expect(f.rpc).toHaveBeenCalledWith('finish_shopify_automatic_pull', {
      p_tenant: tenantId,
      p_id: runId,
      p_outcome: 'complete',
    })
  })
  it('skips Shopify after a duplicate reservation', async () => {
    const f = runFixture({ prepared: false })
    await runAutomaticShopifyPull(
      f.client,
      tenantId,
      env,
      f.http as unknown as typeof fetch,
    )
    expect(f.http).not.toHaveBeenCalled()
    expect(f.calls.some(([n]) => n === 'finish_shopify_automatic_pull')).toBe(
      false,
    )
  })
  it('records only the fixed failure outcome when the provider fails', async () => {
    const f = runFixture({ fail: true })
    await expect(
      runAutomaticShopifyPull(
        f.client,
        tenantId,
        env,
        f.http as unknown as typeof fetch,
      ),
    ).rejects.toThrow('SHOPIFY_AUTOMATION_FAILED')
    expect(f.rpc).toHaveBeenCalledWith('finish_shopify_automatic_pull', {
      p_tenant: tenantId,
      p_id: runId,
      p_outcome: 'failed',
    })
    expect(JSON.stringify(f.calls)).not.toContain('private-provider-body')
    expect(f.calls.some(([n]) => n === 'record_shopify_order_page')).toBe(false)
  })
  it('tolerates only the missing-function deployment gap when reading status', async () => {
    const gap = {
      rpc: vi.fn().mockResolvedValue({ error: { code: 'PGRST202' } }),
    }
    expect(
      await readShopifyAutomaticStatus(
        gap as unknown as SupabaseClient,
        tenantId,
      ),
    ).toEqual({
      available: false,
      run: null,
    })
    const broken = {
      rpc: vi.fn().mockResolvedValue({ error: { code: '42501' } }),
    }
    await expect(
      readShopifyAutomaticStatus(broken as unknown as SupabaseClient, tenantId),
    ).rejects.toThrow('SHOPIFY_READ_FAILED')
  })
})

function cronFixture() {
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data: name === 'accept_automation_grants' ? [] : [{ tenantId }],
  }))
  const client = {
    auth: { signInWithPassword, signOut },
    rpc,
  } as unknown as SupabaseClient
  const makeClient = vi.fn(() => client)
  const run = vi.fn().mockResolvedValue(undefined)
  return { client, signInWithPassword, signOut, rpc, makeClient, run }
}

describe('Shopify cron boundary', () => {
  it('is unavailable without identity configuration', async () => {
    const { makeClient, run } = cronFixture()
    expect(
      (
        await handleShopifyCron(
          request(),
          {},
          makeClient as unknown as typeof createClient,
          run,
        )
      ).status,
    ).toBe(404)
    expect(makeClient).not.toHaveBeenCalled()
  })
  it('rejects a missing or incorrect cron secret before sign-in', async () => {
    const { makeClient, run } = cronFixture()
    for (const authorization of ['', 'Bearer wrong']) {
      expect(
        (
          await handleShopifyCron(
            new Request('https://example.test', { headers: { authorization } }),
            env,
            makeClient as unknown as typeof createClient,
            run,
          )
        ).status,
      ).toBe(401)
    }
    expect(makeClient).not.toHaveBeenCalled()
  })
  it('runs the pilot store and signs out locally', async () => {
    const f = cronFixture()
    expect(
      (
        await handleShopifyCron(
          request(),
          env,
          f.makeClient as unknown as typeof createClient,
          f.run,
        )
      ).status,
    ).toBe(200)
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.rpc).toHaveBeenCalledWith('shopify_automation_tenants')
    expect(f.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(f.signInWithPassword).toHaveBeenCalledWith({
      email: env.KOMISIO_AUTOMATION_EMAIL,
      password: env.KOMISIO_AUTOMATION_PASSWORD,
    })
  })
  it('never runs another store than the pilot', async () => {
    const f = cronFixture()
    f.rpc.mockResolvedValue({ error: null, data: [{ tenantId: other }] })
    f.rpc.mockResolvedValueOnce({ error: null, data: [] })
    expect(
      (
        await handleShopifyCron(
          request(),
          env,
          f.makeClient as unknown as typeof createClient,
          f.run,
        )
      ).status,
    ).toBe(200)
    expect(f.run).not.toHaveBeenCalled()
  })
  it('signs out after a failed run without leaking its error', async () => {
    const f = cronFixture()
    f.run.mockRejectedValue(new Error('provider-secret'))
    const response = await handleShopifyCron(
      request(),
      env,
      f.makeClient as unknown as typeof createClient,
      f.run,
    )
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('provider-secret')
    expect(f.signOut).toHaveBeenCalledTimes(1)
  })
})
