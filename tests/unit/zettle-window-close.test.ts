import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  abandonZettleWindow,
  readZettleWindowClosure,
} from '../../lib/engine/zettle-live'
const tenant = '10000000-0000-4000-8000-000000000001'
const windowId = '20000000-0000-4000-8000-000000000001'
const request = '30000000-0000-4000-8000-000000000001'
it('hides closure controls only during a missing-function deployment gap', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { code: 'PGRST202' } })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readZettleWindowClosure(client, tenant, windowId)).toEqual({
    available: false,
    closure: null,
  })
  rpc.mockResolvedValue({ error: { code: '42501' } })
  await expect(
    readZettleWindowClosure(client, tenant, windowId),
  ).rejects.toThrow('ZETTLE_READ_FAILED')
})
it('validates and sends an explicit actor-bound closure command', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: request, error: null })
  const client = { rpc } as unknown as SupabaseClient
  await expect(
    abandonZettleWindow(client, tenant, request, windowId, '  Stuck page  '),
  ).resolves.toEqual({ id: request })
  expect(rpc).toHaveBeenCalledWith('abandon_zettle_pull_window', {
    p_tenant: tenant,
    p_id: request,
    p_window: windowId,
    p_reason: 'Stuck page',
  })
  await expect(
    abandonZettleWindow(client, tenant, request, windowId, ' '),
  ).rejects.toThrow()
})
