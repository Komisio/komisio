import { describe, expect, it, vi } from 'vitest'
import type { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  handleFortnoxCron,
  readAutomaticFortnoxStatus,
  runAutomaticFortnoxSend,
} from '../../lib/engine/fortnox-automation'
import type { sendExportToFortnox } from '../../lib/engine/fortnox-vouchers'

const tenantId = '10000000-0000-4000-8000-000000000001'
const exportId = '20000000-0000-4000-8000-000000000002'
const env = {
  KOMISIO_INTAKE_ENABLED: 'true',
  KOMISIO_AUTOMATION_EMAIL: 'worker@example.test',
  KOMISIO_AUTOMATION_PASSWORD: 'synthetic-password-long',
  CRON_SECRET: 'synthetic-cron-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
  FORTNOX_PILOT_TENANT_ID: tenantId,
}
const request = (authorization = `Bearer ${env.CRON_SECRET}`) =>
  new Request('https://example.test/api/automation/fortnox-send', {
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
  const makeClient = vi.fn(() => client)
  const run = vi.fn().mockResolvedValue(undefined)
  return { client, rpc, signInWithPassword, signOut, makeClient, run }
}
describe('Fortnox automatic sending', () => {
  it('rejects missing configuration and bad cron secrets before signing in', async () => {
    const setup = fixture()
    const factory = setup.makeClient as unknown as typeof createClient
    expect(
      (await handleFortnoxCron(request(), {}, factory, setup.run)).status,
    ).toBe(404)
    for (const secret of ['', 'Bearer incorrect'])
      expect(
        (await handleFortnoxCron(request(secret), env, factory, setup.run))
          .status,
      ).toBe(401)
    expect(setup.makeClient).not.toHaveBeenCalled()
  })
  it('uses ordinary credentials, accepted grants and local sign-out on every invocation', async () => {
    const setup = fixture()
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        (
          await handleFortnoxCron(
            request(),
            env,
            setup.makeClient as unknown as typeof createClient,
            setup.run,
          )
        ).status,
      ).toBe(200)
    expect(setup.run).toHaveBeenCalledTimes(2)
    expect(setup.signInWithPassword).toHaveBeenCalledWith({
      email: env.KOMISIO_AUTOMATION_EMAIL,
      password: env.KOMISIO_AUTOMATION_PASSWORD,
    })
    expect(setup.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(setup.makeClient).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      'publishable',
      expect.anything(),
    )
  })
  it('does not run for another pilot tenant', async () => {
    const setup = fixture()
    setup.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ tenantId: exportId }], error: null })
    expect(
      (
        await handleFortnoxCron(
          request(),
          env,
          setup.makeClient as unknown as typeof createClient,
          setup.run,
        )
      ).status,
    ).toBe(200)
    expect(setup.run).not.toHaveBeenCalled()
  })
  it('always signs out and exposes only a fixed error after failure', async () => {
    const setup = fixture()
    setup.run.mockRejectedValue(new Error('private provider body'))
    const response = await handleFortnoxCron(
      request(),
      env,
      setup.makeClient as unknown as typeof createClient,
      setup.run,
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'FORTNOX_AUTOMATION_FAILED',
    })
    expect(setup.signOut).toHaveBeenCalledTimes(1)
  })
  it('stops the store at the first failed send and records only its completed count', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: null })
      .mockResolvedValueOnce({
        data: [{ exportId }, { exportId: tenantId }, { exportId }],
        error: null,
      })
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: 'sent' })
      .mockRejectedValueOnce(new Error('provider secret'))
    await expect(
      runAutomaticFortnoxSend(
        { rpc } as unknown as SupabaseClient,
        tenantId,
        env,
        send as unknown as typeof sendExportToFortnox,
      ),
    ).rejects.toThrow('FORTNOX_AUTOMATION_FAILED')
    expect(send).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith(
      'finish_fortnox_automatic_run',
      expect.objectContaining({
        p_tenant: tenantId,
        p_outcome: 'failed',
        p_sent: 1,
      }),
    )
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('provider secret')
  })
  it('stops before another send when the time budget expires', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: null })
      .mockResolvedValueOnce({ data: [{ exportId }], error: null })
    const send = vi.fn()
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(200000)
    await runAutomaticFortnoxSend(
      { rpc } as unknown as SupabaseClient,
      tenantId,
      env,
      send as unknown as typeof sendExportToFortnox,
      now,
    )
    expect(send).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenLastCalledWith(
      'finish_fortnox_automatic_run',
      expect.objectContaining({ p_outcome: 'partial', p_sent: 0 }),
    )
  })
  it('records an empty eligible queue without sending or claiming held exports are reconciled', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const send = vi.fn()
    await runAutomaticFortnoxSend(
      { rpc } as unknown as SupabaseClient,
      tenantId,
      env,
      send as unknown as typeof sendExportToFortnox,
    )
    expect(send).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenLastCalledWith(
      'finish_fortnox_automatic_run',
      expect.objectContaining({ p_outcome: 'complete', p_sent: 0 }),
    )
  })
  it('tolerates only the missing-function deploy gap for the new status read', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    const client = { rpc } as unknown as SupabaseClient
    expect(await readAutomaticFortnoxStatus(client, tenantId)).toEqual({
      available: false,
      run: null,
    })
    await expect(readAutomaticFortnoxStatus(client, tenantId)).rejects.toThrow(
      'FORTNOX_READ_FAILED',
    )
  })
})
