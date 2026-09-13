import { expect, it } from 'vitest'
import { recordReturnCommand } from '../../lib/engine/returns'
import { intakeCommand } from '../../lib/engine/intake'

const base = {
  action: 'recordReturn',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  saleLineId: '33333333-3333-4333-8333-333333333333',
  refund: '500.00',
  reason: 'Customer regret',
}

it('records a full return with an exact refund and a reason', () => {
  expect(intakeCommand.parse(base).action).toBe('recordReturn')
  expect(
    recordReturnCommand.parse({ ...base, occurredAt: '2026-09-14T10:00:00Z' })
      .occurredAt,
  ).toBe('2026-09-14T10:00:00Z')
})
it('rejects float refunds, empty reasons and unknown keys', () => {
  for (const patch of [
    { refund: '500' },
    { refund: 500 },
    { reason: '  ' },
    { partial: true },
    { occurredAt: 'yesterday' },
  ])
    expect(
      recordReturnCommand.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})
