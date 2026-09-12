import { it, expect } from 'vitest'
import { intakeCommand, oreFromDecimal } from '../../lib/engine/intake'
const id = '30000000-0000-4000-8000-000000000001'
it('converts exact decimal text to öre without floating point', () => {
  expect(oreFromDecimal('0.00')).toBe(0)
  expect(oreFromDecimal('150.50')).toBe(15050)
  expect(oreFromDecimal('999999999.99')).toBe(99999999999)
  expect(() => oreFromDecimal('1.5')).toThrow()
  expect(() => oreFromDecimal('1,50')).toThrow()
})
it('requires evidence and an explicit margin attestation on a purchase', () => {
  const command = {
    action: 'registerPurchase',
    tenantId: id,
    requestId: id,
    supplierNote: '',
    purchasePrice: '150.00',
    evidenceReference: 'Kvitto 1',
    marginEligible: true,
  }
  expect(intakeCommand.safeParse(command).success).toBe(true)
  for (const patch of [
    { purchasePrice: '150' },
    { purchasePrice: '-1.00' },
    { evidenceReference: '' },
    { marginEligible: 'yes' },
  ])
    expect(intakeCommand.safeParse({ ...command, ...patch }).success).toBe(
      false,
    )
})
