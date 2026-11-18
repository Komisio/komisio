import { describe, expect, it, vi } from 'vitest'
import type { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  handleCentralGuaranteeCron,
  runCentralGuarantees,
} from '../../lib/engine/central-guarantee-automation'

const tenantId = '10000000-0000-4000-8000-000000000001'
const env = {
  KOMISIO_INTAKE_ENABLED: 'true',
  KOMISIO_CENTRAL_GUARANTEES_ENABLED: 'true',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'synthetic-password-long',
  CRON_SECRET: 'synthetic-cron-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
}
const request = (authorization = `Bearer ${env.CRON_SECRET}`) =>
  new Request('https://example.test/api/automation/central-guarantees', {
    headers: { authorization },
  })
function fixture() {
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
  const makeClient = vi.fn(() => client) as unknown as typeof createClient
  const run = vi.fn().mockResolvedValue({ processed: 100, more: true })
  return { client, rpc, signInWithPassword, signOut, makeClient, run }
}
describe('central guarantee expiry worker', () => {
  it('requires explicit activation and authenticates before accessing the database', async () => {
    const f = fixture()
    expect(
      (
        await handleCentralGuaranteeCron(
          request(),
          { ...env, KOMISIO_CENTRAL_GUARANTEES_ENABLED: 'false' },
          f.makeClient,
          f.run,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await handleCentralGuaranteeCron(
          request('Bearer wrong'),
          env,
          f.makeClient,
          f.run,
        )
      ).status,
    ).toBe(401)
    expect(f.makeClient).not.toHaveBeenCalled()
    const response = await handleCentralGuaranteeCron(
      request(),
      env,
      f.makeClient,
      f.run,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      processed: 100,
      more: true,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(f.signInWithPassword).toHaveBeenCalledWith({
      email: env.KOMISIO_AUTOMATION_EMAIL,
      password: env.KOMISIO_AUTOMATION_PASSWORD,
    })
    expect(f.makeClient).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      'publishable',
      expect.anything(),
    )
    expect(f.run).toHaveBeenCalledExactlyOnceWith(f.client, tenantId)
    expect(f.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('fails closed if the server unexpectedly exposes more than one central tenant', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({ error: null, data: [{ tenantId }, { tenantId }] })
    expect(
      (await handleCentralGuaranteeCron(request(), env, f.makeClient, f.run))
        .status,
    ).toBe(500)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.signOut).toHaveBeenCalledOnce()
  })
  it('does no work without an accepted grant and sanitizes failures', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({ error: null, data: [] })
    expect(
      await (
        await handleCentralGuaranteeCron(request(), env, f.makeClient, f.run)
      ).json(),
    ).toEqual({ ok: true, processed: 0, more: false })
    expect(f.run).not.toHaveBeenCalled()
    f.signInWithPassword.mockResolvedValue({ error: { message: 'private' } })
    const response = await handleCentralGuaranteeCron(
      request(),
      env,
      f.makeClient,
      f.run,
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'GUARANTEE_AUTOMATION_FAILED',
    })
    expect(f.signOut).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed worker results and never accepts a caller-selected clock', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { processed: 1, more: false }, error: null })
    const client = { rpc } as unknown as SupabaseClient
    expect(await runCentralGuarantees(client, tenantId)).toEqual({
      processed: 1,
      more: false,
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('run_central_guarantees', {
      p_tenant: tenantId,
    })
    rpc.mockResolvedValue({
      data: { processed: 101, more: false },
      error: null,
    })
    await expect(runCentralGuarantees(client, tenantId)).rejects.toThrow()
    rpc.mockResolvedValue({ data: null, error: { message: 'private' } })
    await expect(runCentralGuarantees(client, tenantId)).rejects.toThrow(
      'GUARANTEE_AUTOMATION_FAILED',
    )
  })
})
