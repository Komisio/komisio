import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFortnoxSends } from '../../lib/engine/fortnox-vouchers'
it('passes the exact tenant/export to the scoped delivery-history read', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
  const client = { rpc } as unknown as SupabaseClient
  const tenant = '10000000-0000-4000-8000-000000000001',
    id = '20000000-0000-4000-8000-000000000002'
  expect((await readFortnoxSends(client, tenant, id)).size).toBe(0)
  expect(rpc).toHaveBeenCalledWith('fortnox_sends_page', {
    p_tenant: tenant,
    p_export: id,
  })
  await expect(readFortnoxSends(client, tenant, 'bad')).rejects.toThrow()
  expect(rpc).toHaveBeenCalledTimes(1)
})
