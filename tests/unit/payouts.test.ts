import { expect, it } from 'vitest'
import {
  requestPayoutCommand,
  markPayoutPaidCommand,
  rejectPayoutCommand,
  approvePayoutCommand,
} from '../../lib/engine/payouts'
import { intakeCommand } from '../../lib/engine/intake'

const ids = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
}
const payoutId = '44444444-4444-4444-8444-444444444444'

it('accepts the four payout commands with their required fields', () => {
  expect(
    intakeCommand.parse({
      action: 'requestPayout',
      ...ids,
      sellerId: '33333333-3333-4333-8333-333333333333',
      amount: '150.00',
    }).action,
  ).toBe('requestPayout')
  expect(
    approvePayoutCommand.parse({ action: 'approvePayout', ...ids, payoutId })
      .reason,
  ).toBe('')
  expect(
    markPayoutPaidCommand.parse({
      action: 'markPayoutPaid',
      ...ids,
      payoutId,
      reference: ' BG 1 ',
    }).reference,
  ).toBe('BG 1')
  expect(
    rejectPayoutCommand.parse({
      action: 'rejectPayout',
      ...ids,
      payoutId,
      reason: 'Seller asked to wait',
    }).reason,
  ).toBe('Seller asked to wait')
})
it('requires a payment reference and a rejection reason', () => {
  expect(
    markPayoutPaidCommand.safeParse({
      action: 'markPayoutPaid',
      ...ids,
      payoutId,
      reference: '  ',
    }).success,
  ).toBe(false)
  expect(
    rejectPayoutCommand.safeParse({
      action: 'rejectPayout',
      ...ids,
      payoutId,
      reason: '',
    }).success,
  ).toBe(false)
  expect(
    requestPayoutCommand.safeParse({
      action: 'requestPayout',
      ...ids,
      sellerId: payoutId,
      amount: '150',
    }).success,
  ).toBe(false)
})
