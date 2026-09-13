import { expect, it } from 'vitest'
import { issueStatementCommand } from '../../lib/engine/statements'
import { intakeCommand } from '../../lib/engine/intake'

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
