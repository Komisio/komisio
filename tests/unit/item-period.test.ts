import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  currentItemEnd,
  reopenItemPeriodCommand,
  correctItemPeriodEndCommand,
} from '../../lib/engine/item-period'
import { itemCollectionState } from '../../lib/engine/item-collection'
import { executeIntake, intakeCommand } from '../../lib/engine/intake'

const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
const ids = {
  tenantId: id(1),
  requestId: id(2),
  itemId: id(3),
  expectedEndEventId: id(4),
  reason: 'Synthetic correction',
}
it('validates both operations and forwards the end identity through the engine', async () => {
  const reopen = {
    action: 'reopenItemPeriod',
    ...ids,
    saleEndsOn: '2027-04-01',
  } as const
  const correct = {
    action: 'correctItemPeriodEnd',
    ...ids,
    endAction: 'return',
  } as const
  expect(intakeCommand.parse(reopen)).toEqual(reopen)
  expect(intakeCommand.parse(correct)).toEqual(correct)
  const rpc = vi.fn().mockResolvedValue({ data: id(2), error: null })
  await executeIntake({ rpc } as unknown as SupabaseClient, reopen)
  expect(rpc).toHaveBeenLastCalledWith('reopen_item_period', {
    p_tenant: id(1),
    p_id: id(2),
    p_item: id(3),
    p_expected_end: id(4),
    p_sale_ends_on: '2027-04-01',
    p_reason: 'Synthetic correction',
  })
  await executeIntake({ rpc } as unknown as SupabaseClient, correct)
  expect(rpc).toHaveBeenLastCalledWith('correct_item_period_end', {
    p_tenant: id(1),
    p_id: id(2),
    p_item: id(3),
    p_expected_end: id(4),
    p_action: 'return',
    p_reason: 'Synthetic correction',
  })
  for (const bad of [
    { reason: ' ' },
    { saleEndsOn: '2027-02-30' },
    { expectedEndEventId: null },
    { extra: true },
  ])
    expect(
      reopenItemPeriodCommand.safeParse({ ...reopen, ...bad }).success,
    ).toBe(false)
  expect(
    correctItemPeriodEndCommand.safeParse({ ...correct, endAction: 'transfer' })
      .success,
  ).toBe(false)
})
it('projects corrected end actions and hides old collection after reopening', () => {
  const end = {
    id: id(4),
    kind: 'period_ended' as const,
    occurred_at: '2026-10-26T00:00:00Z',
    detail: { action: 'charity' },
  }
  const correction = {
    ...end,
    id: id(5),
    kind: 'period_end_corrected' as const,
    detail: { action: 'return' },
  }
  const reopen = {
    ...end,
    id: id(6),
    kind: 'period_reopened' as const,
    detail: { saleEndsOn: '2027-04-01' },
  }
  expect(currentItemEnd([end, correction])?.id).toBe(id(5))
  expect(itemCollectionState([end, correction])?.endEventId).toBe(id(5))
  expect(currentItemEnd([end, correction, reopen])).toBeNull()
  expect(itemCollectionState([end, correction, reopen])).toBeNull()
  expect(
    currentItemEnd([end, correction, reopen, { ...end, id: id(7) }])?.id,
  ).toBe(id(7))
})
