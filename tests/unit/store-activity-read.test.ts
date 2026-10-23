import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  activityQuery,
  activityResult,
  readStoreActivity,
} from '../../lib/engine/store-activity'

afterEach(() => vi.restoreAllMocks())

it('preserves PostgreSQL target UUIDs without requiring RFC version or variant bits', () => {
  const target = '01234567-89ab-cdef-0123-456789abcdef'
  const result = {
    total: 1,
    rows: [
      {
        id: '9007199254740993',
        actor_id: null,
        actor_name: null,
        actor_state: 'system',
        action: 'zettle.automatic_started',
        target_id: target,
        occurred_at: '2026-10-23T12:00:00Z',
      },
    ],
    actors: [],
  }
  expect(activityResult.parse(result).rows[0].target_id).toBe(target)
  for (const target_id of ['not-a-uuid', '<script>', target.slice(1)]) {
    expect(
      activityResult.safeParse({
        ...result,
        rows: [{ ...result.rows[0], target_id }],
      }).success,
    ).toBe(false)
  }
})

it.each(['rpc', 'response', 'transport'] as const)(
  'returns a safe failure for %s without logging private data',
  async (reason) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpc = vi.fn()
    if (reason === 'rpc')
      rpc.mockResolvedValue({
        error: { message: 'PRIVATE DATABASE DETAIL' },
        data: null,
      })
    if (reason === 'response')
      rpc.mockResolvedValue({
        error: null,
        data: { private: 'PRIVATE EVENT DATA' },
      })
    if (reason === 'transport')
      rpc.mockRejectedValue(new Error('PRIVATE CONNECTION DETAIL'))
    const result = await readStoreActivity(
      { rpc } as unknown as SupabaseClient,
      '11111111-1111-4111-8111-111111111111',
      activityQuery.parse({}),
    )
    expect(result).toEqual({ ok: false })
    expect(log).toHaveBeenCalledExactlyOnceWith('Store activity read failed', {
      reason,
    })
  },
)

it('keeps a successful empty read distinct from a failed read and preserves scoped filters', async () => {
  const data = { total: 0, rows: [], actors: [] }
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  const id = '11111111-1111-4111-8111-111111111111'
  expect(
    await readStoreActivity(
      { rpc } as unknown as SupabaseClient,
      id,
      activityQuery.parse({
        from: '2026-10-01',
        to: '2026-10-23',
        actor: id,
        kind: 'future.action',
        page: 2,
      }),
    ),
  ).toEqual({ ok: true, data })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('store_activity', {
    p_tenant: id,
    p_actor: id,
    p_from: '2026-10-01',
    p_to: '2026-10-23',
    p_action: 'future.action',
    p_offset: 25,
    p_limit: 25,
  })
})
