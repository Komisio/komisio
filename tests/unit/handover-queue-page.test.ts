import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readHandoverQueuePage } from '../../lib/engine/handovers'
const tenant = '97000000-0000-4000-8000-000000000001'
it('falls back only when the additive read is missing', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ error: { code: '42501' } })
    .mockResolvedValueOnce({ error: { code: '57014' } })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readHandoverQueuePage(client, tenant)).toBeNull()
  await expect(readHandoverQueuePage(client, tenant)).rejects.toThrow(
    'Unable to read the handover queue',
  )
  await expect(readHandoverQueuePage(client, tenant)).rejects.toThrow(
    'Unable to read the handover queue',
  )
})
it('rejects malformed input before reading', async () => {
  const rpc = vi.fn(),
    client = { rpc } as unknown as SupabaseClient
  for (const offset of [-1, 0.5, 2147483648, NaN])
    await expect(
      readHandoverQueuePage(client, tenant, { offset }),
    ).rejects.toThrow()
  await expect(readHandoverQueuePage(client, 'invalid')).rejects.toThrow()
  await expect(
    readHandoverQueuePage(client, tenant, { query: 'x'.repeat(121) }),
  ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
it('preserves full total and filters on an empty page', async () => {
  const data = { handovers: [], total: 103, offset: 125 }
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  expect(
    await readHandoverQueuePage({ rpc } as unknown as SupabaseClient, tenant, {
      query: ' Anna ',
      status: 'open',
      offset: 125,
    }),
  ).toEqual(data)
  expect(rpc).toHaveBeenCalledWith('handover_queue_page', {
    p_tenant: tenant,
    p_query: 'Anna',
    p_status: 'open',
    p_offset: 125,
  })
})
