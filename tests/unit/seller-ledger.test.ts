import { expect, it } from 'vitest'
import {
  adjustSellerLedgerCommand,
  sellerBalance,
  signedOreFromDecimal,
  formatSignedOre,
} from '../../lib/engine/seller-ledger'
import { intakeCommand } from '../../lib/engine/intake'

const base = {
  action: 'adjustSellerLedger',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  sellerId: '33333333-3333-4333-8333-333333333333',
  amount: '-5.00',
  reason: 'Damaged label refund',
}

it('adjusts with a signed exact decimal and a reason', () => {
  expect(intakeCommand.parse(base).action).toBe('adjustSellerLedger')
  expect(signedOreFromDecimal('-5.00')).toBe(-500)
  expect(signedOreFromDecimal('12.50')).toBe(1250)
  expect(signedOreFromDecimal('0.01')).toBe(1)
  expect(formatSignedOre(-500)).toBe('-5.00')
  expect(formatSignedOre(1250)).toBe('12.50')
})
it('rejects float-shaped amounts and empty reasons', () => {
  for (const patch of [
    { amount: '5' },
    { amount: '5.5' },
    { amount: -5 },
    { amount: '+5.00' },
    { reason: '   ' },
    { reason: 'x'.repeat(501) },
  ])
    expect(
      adjustSellerLedgerCommand.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
  expect(() => signedOreFromDecimal('5')).toThrow('INVALID_INPUT')
})
it('parses the balance shape the database returns', () => {
  const b = sellerBalance.parse({
    sellerId: base.sellerId,
    availableOre: '9500',
    reservedOre: 0,
    creditedOre: 10000,
    paidOre: 0,
    entries: 2,
  })
  expect(b.availableOre).toBe(9500)
})
