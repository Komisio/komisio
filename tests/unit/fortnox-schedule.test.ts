import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readFortnoxSchedule,
  saveFortnoxSchedule,
  sendTime,
} from '../../lib/engine/fortnox-schedule'

const tenantId = '10000000-0000-4000-8000-000000000001'
const requestId = '20000000-0000-4000-8000-000000000002'
const input = { tenantId, requestId, previousId: null, time: '23:59' }
describe('Fortnox send time', () => {
  it.each(['00:00', '07:00', '23:59'])('accepts %s', (time) => {
    expect(sendTime.safeParse(time).success).toBe(true)
  })
  it.each([
    '',
    '24:00',
    '07:60',
    '7:00',
    '07:00:00',
    ' 07:00',
    '07:00 ',
    'noon',
  ])('rejects %s', (time) => {
    expect(sendTime.safeParse(time).success).toBe(false)
  })
  it('verifies the saved request and time', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { id: requestId, time: '23:59' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: tenantId, time: '23:59' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: requestId, time: '07:00' },
        error: null,
      })
    const client = { rpc } as unknown as SupabaseClient
    expect(await saveFortnoxSchedule(client, input)).toEqual({
      ok: true,
      schedule: { id: requestId, time: '23:59' },
    })
    await expect(saveFortnoxSchedule(client, input)).rejects.toThrow(
      'REQUEST_FAILED',
    )
    await expect(saveFortnoxSchedule(client, input)).rejects.toThrow(
      'REQUEST_FAILED',
    )
  })
  it('only tolerates the missing RPC deployment gap', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    const client = { rpc } as unknown as SupabaseClient
    expect(await readFortnoxSchedule(client, tenantId)).toBeNull()
    await expect(readFortnoxSchedule(client, tenantId)).rejects.toThrow(
      'FORTNOX_READ_FAILED',
    )
  })
  it('does not expose unexpected database errors', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'private details' } })
    await expect(
      saveFortnoxSchedule({ rpc } as unknown as SupabaseClient, input),
    ).rejects.toThrow('REQUEST_FAILED')
  })
})
