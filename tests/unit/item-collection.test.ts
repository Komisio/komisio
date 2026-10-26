import { expect, it, vi } from 'vitest'
import {
  itemCollectionState,
  recordItemCollectionCommand,
} from '../../lib/engine/item-collection'
import { executeIntake, intakeCommand } from '../../lib/engine/intake'
import type { SupabaseClient } from '@supabase/supabase-js'

const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
const command = {
  action: 'recordItemCollection',
  tenantId: id(1),
  requestId: id(2),
  itemId: id(3),
  endEventId: id(4),
  expectedCurrentId: null,
  collected: false,
  observedOn: '2026-10-26',
  note: 'Checked shelf',
} as const
it('validates collection evidence and uses the engine RPC', async () => {
  expect(intakeCommand.parse(command)).toEqual(command)
  const rpc = vi.fn().mockResolvedValue({ data: id(2), error: null })
  await executeIntake({ rpc } as unknown as SupabaseClient, command)
  expect(rpc).toHaveBeenCalledWith('record_item_collection', {
    p_tenant: id(1),
    p_id: id(2),
    p_item: id(3),
    p_end_event: id(4),
    p_expected_current: null,
    p_collected: false,
    p_observed_on: '2026-10-26',
    p_note: 'Checked shelf',
  })
  for (const bad of [
    { collected: 'false' },
    { observedOn: '2026-02-30' },
    { observedOn: '2026-10-26T00:00:00Z' },
    { endEventId: 'x' },
    { note: 'x'.repeat(501) },
    { extra: 'x' },
  ])
    expect(
      recordItemCollectionCommand.safeParse({ ...command, ...bad }).success,
    ).toBe(false)
})
it('uses only the latest observation tied to this return, without changing input order', () => {
  const end = {
    id: id(4),
    kind: 'period_ended' as const,
    occurred_at: '2026-10-26T00:00:00Z',
    detail: { action: 'return' },
  }
  const first = {
    id: id(5),
    kind: 'collection_recorded' as const,
    occurred_at: '2026-10-26T00:00:00.000001Z',
    detail: {
      endEventId: id(4),
      collected: false,
      observedOn: '2026-10-26',
      note: '',
    },
  }
  const second = {
    ...first,
    id: id(6),
    occurred_at: '2026-10-26T00:00:00.000002Z',
    detail: { ...first.detail, collected: true },
  }
  const events = [end, first, second]
  expect(itemCollectionState(events)?.current?.id).toBe(id(6))
  expect(itemCollectionState(events)?.current?.collected).toBe(true)
  expect(events[0]).toBe(end)
  expect(itemCollectionState([end])).toEqual({
    endEventId: id(4),
    current: null,
  })
  expect(
    itemCollectionState([{ ...end, detail: { action: 'charity' } }]),
  ).toBeNull()
  expect(
    itemCollectionState([
      end,
      { ...second, detail: { ...second.detail, endEventId: id(8) } },
    ])?.current,
  ).toBeNull()
})
