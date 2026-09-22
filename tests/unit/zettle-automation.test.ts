import { describe, expect, it, vi } from 'vitest'
import type { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  handleZettleCron,
  readAutomaticPullStatus,
  runAutomaticZettlePull,
} from '../../lib/engine/zettle-automation'

const tenantId = '10000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_INTAKE_ENABLED: 'true',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'password-long-enough',
  CRON_SECRET: 'cron-secret-long-enough',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
  ZETTLE_PILOT_TENANT_ID: tenantId,
  ZETTLE_CLIENT_ID: 'client',
  ZETTLE_API_KEY: 'provider-secret',
  ZETTLE_MERCHANT_ID: '20000000-0000-4000-8000-000000000002',
}
const request = () =>
  new Request('https://example.test/api/automation/zettle-pull', {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  })
function fixture() {
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'read_paypal_credentials'
        ? null
        : name === 'accept_automation_grants'
          ? []
          : [{ tenantId }],
  }))
  const client = {
    auth: { signInWithPassword, signOut },
    rpc,
  } as unknown as SupabaseClient
  const makeClient = vi.fn(() => client)
  const run = vi.fn().mockResolvedValue(undefined)
  return { client, signInWithPassword, signOut, rpc, makeClient, run }
}
describe('Zettle cron boundary', () => {
  it('records a verified empty page through the window command', async () => {
    const job = {
      id: '01234567-89ab-cdef-0123-456789abcdef',
      windowId: env.ZETTLE_MERCHANT_ID,
      startDate: '2026-09-14T10:00:00Z',
      endDate: '2026-09-14T11:00:00Z',
      cursor: null,
      currency: 'SEK',
    }
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: null })
      .mockResolvedValueOnce({ data: job, error: null })
    const fetchPage = vi.fn().mockResolvedValue({ purchases: [] })
    const factory = vi.fn().mockResolvedValue({ fetchPage })
    await runAutomaticZettlePull(
      { rpc } as unknown as SupabaseClient,
      tenantId,
      env,
      factory,
    )
    expect(rpc).toHaveBeenCalledWith('record_zettle_pull_page', {
      p_tenant: tenantId,
      p_id: job.id,
      p_window: job.windowId,
      p_before: null,
      p_after: null,
      p_purchases: [],
    })
    expect(rpc).toHaveBeenCalledWith('finish_zettle_automatic_pull', {
      p_tenant: tenantId,
      p_id: job.id,
      p_outcome: 'complete',
    })
  })
  it('persists only a fixed failure outcome after provider rejection', async () => {
    const job = {
      id: tenantId,
      windowId: env.ZETTLE_MERCHANT_ID,
      startDate: '2026-09-14T10:00:00Z',
      endDate: '2026-09-14T11:00:00Z',
      cursor: null,
      currency: 'SEK',
    }
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: null })
      .mockResolvedValueOnce({ data: job, error: null })
    const factory = vi
      .fn()
      .mockRejectedValue(new Error('private-provider-body'))
    await expect(
      runAutomaticZettlePull(
        { rpc } as unknown as SupabaseClient,
        tenantId,
        env,
        factory,
      ),
    ).rejects.toThrow('ZETTLE_AUTOMATION_FAILED')
    expect(rpc).toHaveBeenCalledWith('finish_zettle_automatic_pull', {
      p_tenant: tenantId,
      p_id: job.id,
      p_outcome: 'failed',
    })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(
      'private-provider-body',
    )
    expect(
      rpc.mock.calls.some(([name]) => name === 'record_zettle_pull_page'),
    ).toBe(false)
  })
  it('is unavailable without identity configuration', async () => {
    const { makeClient, run } = fixture()
    expect(
      (
        await handleZettleCron(
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
    const { makeClient, run } = fixture()
    for (const authorization of ['', 'Bearer wrong']) {
      expect(
        (
          await handleZettleCron(
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
  it('runs existing accepted grants on repeated invocations and signs out locally', async () => {
    const setup = fixture()
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        (
          await handleZettleCron(
            request(),
            env,
            setup.makeClient as unknown as typeof createClient,
            setup.run,
          )
        ).status,
      ).toBe(200)
    expect(setup.run).toHaveBeenCalledTimes(2)
    expect(setup.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(setup.signInWithPassword).toHaveBeenCalledWith({
      email: env.KOMISIO_AUTOMATION_EMAIL,
      password: env.KOMISIO_AUTOMATION_PASSWORD,
    })
  })
  it('never calls the provider for another tenant', async () => {
    const setup = fixture()
    setup.rpc.mockImplementation(async (name: string) => ({
      error: null,
      data:
        name === 'read_paypal_credentials'
          ? null
          : [{ tenantId: env.ZETTLE_MERCHANT_ID }],
    }))
    setup.rpc.mockResolvedValueOnce({ error: null, data: [] })
    expect(
      (
        await handleZettleCron(
          request(),
          env,
          setup.makeClient as unknown as typeof createClient,
          setup.run,
        )
      ).status,
    ).toBe(200)
    expect(setup.run).not.toHaveBeenCalled()
  })
  it('signs out after provider failure without leaking its error body', async () => {
    const setup = fixture()
    setup.run.mockRejectedValue(new Error('provider-secret'))
    const response = await handleZettleCron(
      request(),
      env,
      setup.makeClient as unknown as typeof createClient,
      setup.run,
    )
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('provider-secret')
    expect(setup.signOut).toHaveBeenCalledTimes(1)
  })
  it('signs out even after sign-in fails', async () => {
    const setup = fixture()
    setup.signInWithPassword.mockRejectedValue(new Error('password'))
    expect(
      (
        await handleZettleCron(
          request(),
          env,
          setup.makeClient as unknown as typeof createClient,
          setup.run,
        )
      ).status,
    ).toBe(500)
    expect(setup.run).not.toHaveBeenCalled()
    expect(setup.signOut).toHaveBeenCalled()
  })
  it('skips HTTP after a duplicate cron reservation', async () => {
    const { client, rpc } = fixture()
    rpc.mockResolvedValue({ error: null, data: null as never })
    const factory = vi.fn()
    await runAutomaticZettlePull(client, tenantId, env, factory)
    expect(factory).not.toHaveBeenCalled()
  })
  it('tolerates only the missing-function deployment gap', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: 'PGRST202' } })
    const client = { rpc } as unknown as SupabaseClient
    expect(await readAutomaticPullStatus(client, tenantId)).toEqual({
      available: false,
      run: null,
    })
    rpc.mockResolvedValue({ error: { code: '42501' } })
    await expect(readAutomaticPullStatus(client, tenantId)).rejects.toThrow(
      'ZETTLE_READ_FAILED',
    )
  })
})
