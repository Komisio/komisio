import { describe, expect, it, vi } from 'vitest'
import type { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  handleDayCloseCron,
  readAutomaticDayCloseStatus,
  runAutomaticDayCloses,
} from '../../lib/engine/day-close-automation'

const tenantId = '10000000-0000-4000-8000-000000000001'
const otherId = '20000000-0000-4000-8000-000000000002'
const result = {
  grantId: otherId,
  from: '2026-10-09',
  through: '2026-10-09',
  checked: 1,
  created: 1,
  unchanged: 0,
  skipped: 0,
  outcome: 'complete' as const,
}
const env = {
  KOMISIO_INTAKE_ENABLED: 'true',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'synthetic-password-long',
  CRON_SECRET: 'synthetic-cron-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
}
const request = (authorization = `Bearer ${env.CRON_SECRET}`) =>
  new Request('https://example.test/api/automation/day-closes', {
    headers: { authorization },
  })
function fixture() {
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'accept_automation_grants'
        ? []
        : [{ tenantId }, { tenantId: otherId }],
  }))
  const client = {
    auth: { signInWithPassword, signOut },
    rpc,
  } as unknown as SupabaseClient
  const makeClient = vi.fn(() => client) as unknown as typeof createClient
  const run = vi.fn().mockResolvedValue(result)
  return { client, rpc, signInWithPassword, signOut, makeClient, run }
}
describe('automatic day-close preparation', () => {
  it('authenticates the cron before creating an ordinary client', async () => {
    const f = fixture()
    expect(
      (await handleDayCloseCron(request(), {}, f.makeClient, f.run)).status,
    ).toBe(404)
    expect(
      (
        await handleDayCloseCron(
          request('Bearer wrong'),
          env,
          f.makeClient,
          f.run,
        )
      ).status,
    ).toBe(401)
    expect(f.makeClient).not.toHaveBeenCalled()
    const response = await handleDayCloseCron(
      request(),
      env,
      f.makeClient,
      f.run,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      ok: true,
      processed: 2,
      catchingUp: false,
    })
    expect(f.signInWithPassword).toHaveBeenCalledWith({
      email: env.KOMISIO_AUTOMATION_EMAIL,
      password: env.KOMISIO_AUTOMATION_PASSWORD,
    })
    expect(f.makeClient).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      'publishable',
      expect.anything(),
    )
    expect(f.rpc).toHaveBeenCalledWith('accept_automation_grants')
    expect(f.run.mock.calls.map((call) => call[1])).toEqual([tenantId, otherId])
    expect(f.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('continues other stores after failure, signs out and hides internal errors', async () => {
    const f = fixture()
    f.run.mockRejectedValueOnce(new Error('private database message'))
    const response = await handleDayCloseCron(
      request(),
      env,
      f.makeClient,
      f.run,
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'DAY_CLOSE_AUTOMATION_FAILED',
    })
    expect(f.run).toHaveBeenCalledTimes(2)
    expect(f.signOut).toHaveBeenCalledTimes(1)
  })
  it('signs out even if authentication fails', async () => {
    const f = fixture()
    f.signInWithPassword.mockResolvedValue({ error: { message: 'secret' } })
    expect(
      (await handleDayCloseCron(request(), env, f.makeClient, f.run)).status,
    ).toBe(500)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.signOut).toHaveBeenCalledTimes(1)
  })
  it('uses one global budget and leaves unfinished tenants for another run', async () => {
    const f = fixture()
    const now = vi
      .fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValue(200101)
    const response = await handleDayCloseCron(
      request(),
      env,
      f.makeClient,
      f.run,
      now,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'DAY_CLOSE_AUTOMATION_INCOMPLETE',
      processed: 1,
    })
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.signOut).toHaveBeenCalledTimes(1)
  })
  it('reports a bounded backlog without pretending it is caught up', async () => {
    const f = fixture()
    f.run.mockResolvedValue({ ...result, outcome: 'partial' })
    const response = await handleDayCloseCron(
      request(),
      env,
      f.makeClient,
      f.run,
    )
    expect(await response.json()).toEqual({
      ok: true,
      processed: 2,
      catchingUp: true,
    })
  })
  it('retains a supplied retry ID and never calls export or send operations', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null })
    const client = { rpc } as unknown as SupabaseClient
    await runAutomaticDayCloses(client, tenantId, otherId)
    await runAutomaticDayCloses(client, tenantId, otherId)
    expect(rpc.mock.calls).toEqual([
      ['run_automatic_day_closes', { p_tenant: tenantId, p_id: otherId }],
      ['run_automatic_day_closes', { p_tenant: tenantId, p_id: otherId }],
    ])
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'private database message' },
    })
    await expect(runAutomaticDayCloses(client, tenantId)).rejects.toThrow(
      'DAY_CLOSE_AUTOMATION_FAILED',
    )
  })
  it('distinguishes a missing migration from an enabled scope with no run', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: null, error: null })
    const client = { rpc } as unknown as SupabaseClient
    expect(await readAutomaticDayCloseStatus(client, tenantId)).toEqual({
      available: false,
      run: null,
    })
    expect(await readAutomaticDayCloseStatus(client, tenantId)).toEqual({
      available: true,
      run: null,
    })
  })
})
