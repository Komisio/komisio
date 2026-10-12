import { describe, expect, it, vi } from 'vitest'
import type { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  handleCatalogCron,
  runAutomaticCatalogExport,
} from '../../lib/engine/catalog-worker'

const tenantId = '10000000-0000-4000-8000-000000000001'
const itemId = '20000000-0000-4000-8000-000000000001'
const id = '30000000-0000-4000-8000-000000000001'
const merchant = '40000000-0000-4000-8000-000000000001'
const target = { tenantId, provider: 'paypal' as const }
const env = {
  KOMISIO_INTAKE_ENABLED: 'true',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'synthetic-password-long',
  CRON_SECRET: 'synthetic-cron-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
}
const source = {
  ZETTLE_PILOT_TENANT_ID: tenantId,
  ZETTLE_MERCHANT_ID: merchant,
  ZETTLE_CLIENT_ID: 'client',
  ZETTLE_API_KEY: 'secret',
}
const request = () =>
  new Request('https://example.test/api/automation/catalog-export', {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  })
function fixture() {
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'claim_catalog_export'
        ? { id, itemId, provider: 'paypal', connectionId: merchant }
        : null,
  }))
  const client = { rpc } as unknown as SupabaseClient
  const resolve = vi.fn().mockResolvedValue(source)
  const sync = vi.fn().mockResolvedValue({ id, stock: 'initialized' })
  return { rpc, client, resolve, sync }
}
describe('automatic catalog export', () => {
  it('uses one lease identity for the existing adapter and records its result', async () => {
    const f = fixture()
    expect(
      await runAutomaticCatalogExport(f.client, target, env, f.resolve, f.sync),
    ).toBe(true)
    expect(f.sync).toHaveBeenCalledWith(f.client, tenantId, id, itemId, source)
    expect(f.rpc).toHaveBeenLastCalledWith('finish_catalog_export', {
      p_tenant: tenantId,
      p_id: id,
      p_outcome: 'complete',
    })
  })
  it('does not fetch credentials or call transport after an empty/replayed claim', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({ data: null, error: null })
    expect(
      await runAutomaticCatalogExport(f.client, target, env, f.resolve, f.sync),
    ).toBe(false)
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.sync).not.toHaveBeenCalled()
  })
  it('stops before transport if the connected account changed', async () => {
    const f = fixture()
    f.resolve.mockResolvedValue({ ...source, ZETTLE_MERCHANT_ID: id })
    await expect(
      runAutomaticCatalogExport(f.client, target, env, f.resolve, f.sync),
    ).rejects.toThrow('CATALOG_EXPORT_FAILED')
    expect(f.sync).not.toHaveBeenCalled()
  })
  it.each(['unknown', 'conflict', 'depleted'])(
    'holds unconfirmed stock %s',
    async (stock) => {
      const f = fixture()
      f.sync.mockResolvedValue({ id, stock })
      await runAutomaticCatalogExport(f.client, target, env, f.resolve, f.sync)
      expect(f.rpc).toHaveBeenLastCalledWith('finish_catalog_export', {
        p_tenant: tenantId,
        p_id: id,
        p_outcome: 'held',
      })
    },
  )
  it('redacts arbitrary provider failures and never retries them in the worker', async () => {
    const f = fixture()
    f.sync.mockRejectedValue(new Error('secret raw provider data'))
    await expect(
      runAutomaticCatalogExport(f.client, target, env, f.resolve, f.sync),
    ).rejects.toThrow(/^CATALOG_EXPORT_FAILED$/)
    expect(f.sync).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('secret')
  })
  it('keeps the cron authenticated, bounded and signed out', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'accept_automation_grants' ? [] : [target],
      error: null,
    }))
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const make = vi.fn(() => ({
      rpc,
      auth: { signInWithPassword, signOut },
    })) as unknown as typeof createClient
    const run = vi.fn().mockResolvedValue(true)
    expect(
      (
        await handleCatalogCron(
          new Request('https://example.test'),
          env,
          make,
          run,
        )
      ).status,
    ).toBe(401)
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect((await handleCatalogCron(request(), env, make, run)).status).toBe(
      200,
    )
    expect(run).toHaveBeenCalledTimes(10)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('continues other connections after failure without exposing details', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === 'accept_automation_grants'
          ? []
          : [target, { ...target, tenantId: itemId }],
      error: null,
    }))
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const make = vi.fn(() => ({
      rpc,
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        signOut,
      },
    })) as unknown as typeof createClient
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('raw secret'))
      .mockResolvedValue(false)
    const response = await handleCatalogCron(request(), env, make, run)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'CATALOG_AUTOMATION_FAILED',
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(signOut).toHaveBeenCalledOnce()
  })
})
