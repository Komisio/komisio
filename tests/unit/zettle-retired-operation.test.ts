import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  operationKind,
  proposeOperationCommand,
  readOperationQueue,
} from '../../lib/engine/operations'
import { readOperationReview } from '../../lib/engine/operation-review'
const id = '10000000-0000-4000-8000-000000000001'
it('does not accept new Zettle staged proposals', () => {
  expect(operationKind.safeParse('recordZettlePurchase').success).toBe(false)
  expect(
    proposeOperationCommand.safeParse({
      tenantId: id,
      requestId: id,
      actorLabel: 'manual',
      expiresAt: '2026-09-15T00:00:00Z',
      kind: 'recordZettlePurchase',
      payload: { importId: id, mappingRevision: 0 },
    }).success,
  ).toBe(false)
})
it('omits legacy queue rows without hiding malformed supported operations', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({
      data: [{ kind: 'recordZettlePurchase', payload: {} }],
      error: null,
    })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readOperationQueue(client, id)).toEqual([])
  rpc.mockResolvedValue({
    data: [{ kind: 'acceptItem', payload: {} }],
    error: null,
  })
  await expect(readOperationQueue(client, id)).rejects.toThrow()
})
it('returns not found for a retired review before loading receipt context', async () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({
        data: { kind: 'recordZettlePurchase' },
        error: null,
      }),
  }
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: 'owner', error: null }),
    from: vi.fn().mockReturnValue(query),
  } as unknown as SupabaseClient
  await expect(
    readOperationReview(client, id, { operationId: id }),
  ).rejects.toThrow('OPERATION_NOT_FOUND')
  expect(client.from).toHaveBeenCalledTimes(1)
})
