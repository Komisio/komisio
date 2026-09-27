import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { issueStatementCommand } from '../../lib/engine/statements'
import { intakeCommand, executeIntake } from '../../lib/engine/intake'

const base = {
  action: 'issueStatement',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  sellerId: '33333333-3333-4333-8333-333333333333',
  periodFrom: '2026-09-01T00:00:00Z',
  periodTo: '2026-10-01T00:00:00Z',
}

it('issues a statement for a closed period and defaults to no correction', () => {
  expect(intakeCommand.parse(base).action).toBe('issueStatement')
  expect(issueStatementCommand.parse(base).correctsId).toBe(null)
  expect(
    issueStatementCommand.parse({ ...base, correctsId: base.sellerId })
      .correctsId,
  ).toBe(base.sellerId)
})
it('rejects an empty or inverted period and loose dates', () => {
  for (const patch of [
    { periodTo: base.periodFrom },
    { periodTo: '2026-08-01T00:00:00Z' },
    { periodFrom: '2026-09-01' },
    { number: 5 },
  ])
    expect(
      issueStatementCommand.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})

it('accepts inclusive calendar days only with an explicit calendar mode', () => {
  const days = {
    ...base,
    calendar: 'stockholm-days',
    periodFrom: '2026-03-29',
    periodTo: '2026-03-29',
  }
  expect(intakeCommand.parse(days).action).toBe('issueStatement')
  for (const patch of [
    { calendar: undefined },
    { calendar: 'browser-local' },
    { periodFrom: '2026-02-30' },
    { periodTo: '2026-03-28' },
    { periodFrom: base.periodFrom },
  ])
    expect(issueStatementCommand.safeParse({ ...days, ...patch }).success).toBe(
      false,
    )
})

it('routes day commands to the adapter and leaves timestamp commands unchanged', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: base.requestId, error: null })
  const client = { rpc } as unknown as SupabaseClient
  await executeIntake(client, base)
  expect(rpc).toHaveBeenLastCalledWith(
    'issue_statement',
    expect.objectContaining({ p_from: base.periodFrom, p_to: base.periodTo }),
  )
  await executeIntake(client, {
    ...base,
    calendar: 'stockholm-days',
    periodFrom: '2026-03-29',
    periodTo: '2026-03-29',
  })
  expect(rpc).toHaveBeenLastCalledWith(
    'issue_statement_for_days',
    expect.objectContaining({
      p_from: '2026-03-29',
      p_to: '2026-03-29',
      p_corrects: null,
    }),
  )
})
