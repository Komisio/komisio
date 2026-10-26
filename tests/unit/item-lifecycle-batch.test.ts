import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeLifecycleBatch,
  lifecycleBatchCommand,
} from '../../lib/engine/item-lifecycle-batch'
const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
it('bounds human batches and rejects unsupported actions or inexact money', () => {
  const input = {
    action: 'preview',
    tenantId: id(1),
    items: [id(2)],
    operation: {
      kind: 'setPrice',
      priceOre: 15001,
      reason: 'Synthetic change',
    },
  }
  expect(lifecycleBatchCommand.parse(input)).toEqual(input)
  for (const patch of [
    { items: [] },
    { items: [id(2), id(2)] },
    { items: Array.from({ length: 51 }, (_, i) => id(i)) },
    { operation: { kind: 'pause' } },
    { operation: { ...input.operation, priceOre: 1.5 } },
    { operation: { kind: 'extend', days: 366, reason: 'Test' } },
  ])
    expect(
      lifecycleBatchCommand.safeParse({ ...input, ...patch }).success,
    ).toBe(false)
})
it('routes preview and apply through scoped engine RPCs and validates returned outcomes', async () => {
  const operation = { kind: 'end', endAction: 'return', reason: '' } as const
  const preview = [
    {
      itemId: id(2),
      title: 'Synthetic',
      token: 'a'.repeat(32),
      eligible: true,
      reason: null,
      priceOre: 10000,
      periodEnd: null,
      step: null,
    },
  ]
  const result = {
    id: id(3),
    items: [{ itemId: id(2), status: 'applied', reason: null, eventId: id(4) }],
  }
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: preview, error: null })
    .mockResolvedValueOnce({ data: result, error: null })
  const client = { rpc } as unknown as SupabaseClient
  expect(
    await executeLifecycleBatch(client, {
      action: 'preview',
      tenantId: id(1),
      items: [id(2)],
      operation,
    }),
  ).toEqual(preview)
  expect(rpc).toHaveBeenLastCalledWith('preview_item_lifecycle_batch', {
    p_tenant: id(1),
    p_items: [id(2)],
    p_operation: operation,
  })
  expect(
    await executeLifecycleBatch(client, {
      action: 'apply',
      tenantId: id(1),
      requestId: id(3),
      operation,
      preview,
    }),
  ).toEqual(result)
  expect(rpc).toHaveBeenLastCalledWith('apply_item_lifecycle_batch', {
    p_tenant: id(1),
    p_id: id(3),
    p_operation: operation,
    p_preview: preview,
  })
})
