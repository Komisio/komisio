import { expect, it } from 'vitest'
import {
  operationPageInput,
  readOperationPage,
} from '../../lib/engine/operation-page'
import { operationQueueHref } from '../../lib/intake/operation-navigation'
import type { SupabaseClient } from '@supabase/supabase-js'

const id = '10000000-0000-4000-8000-000000000001',
  stamp = '2026-09-01T12:00:00.123456+00:00'
it('preserves exact microseconds and status through a browser cursor round trip', () => {
  const input = { status: 'open', beforeCreated: stamp, beforeId: id }
  const url = new URL(operationQueueHref(input), 'https://example.test')
  expect(
    operationPageInput.parse(Object.fromEntries(url.searchParams)),
  ).toEqual(input)
  expect(operationQueueHref({ status: 'failed' })).not.toContain('before')
})
it('rejects partial, repeated, unknown and malformed navigation inputs', () => {
  for (const input of [
    { beforeId: id },
    { beforeCreated: stamp },
    { status: ['open'] },
    { status: 'approved' },
    { status: 'all', tenantId: id },
    { beforeCreated: 'infinity', beforeId: id },
  ])
    expect(operationPageInput.safeParse(input).success).toBe(false)
})
it('the probe row is not displayed or used as the next cursor', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    kind: 'saveInspectionDraft',
    risk_level: 'low',
    actor_kind: 'agent',
    actor_label: 'fixture',
    proposed_by: id,
    payload: {
      bagId: id,
      draftId: id,
      expectedRevision: 1,
      fields: { description: 'Fixture', category: '', condition: '' },
    },
    expires_at: stamp,
    created_at: stamp,
    status: 'open',
    decision_id: null,
    outcome: null,
    result_id: null,
    error_code: null,
    reason: null,
    decided_by: null,
    decided_at: null,
  }))
  const client = {
    rpc: async () => ({ data: rows, error: null }),
  } as unknown as SupabaseClient
  const result = await readOperationPage(client, id)
  expect(result.items).toHaveLength(20)
  expect(result.nextBefore).toEqual({
    beforeCreated: stamp,
    beforeId: rows[19].id,
  })
  const last = await readOperationPage(
    {
      rpc: async () => ({ data: rows.slice(0, 20), error: null }),
    } as unknown as SupabaseClient,
    id,
  )
  expect(last.nextBefore).toBeNull()
})
