import { describe, expect, it } from 'vitest'
import { intakeCommand } from '../../lib/engine/intake'

const identity = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
}
describe('intake command boundary', () => {
  it('requires a contact channel without requiring an email account', () => {
    const input = {
      ...identity,
      action: 'registerSeller',
      name: ' Seller ',
      email: '',
      phone: '',
    }
    expect(intakeCommand.safeParse(input).success).toBe(false)
    expect(intakeCommand.parse({ ...input, phone: '12345' })).toMatchObject({
      name: 'Seller',
      phone: '12345',
    })
  })
  it('rejects invalid email, oversized notes and absent seller references', () => {
    expect(
      intakeCommand.safeParse({
        ...identity,
        action: 'registerSeller',
        name: 'Seller',
        email: 'not-email',
        phone: '',
      }).success,
    ).toBe(false)
    const bag = {
      ...identity,
      action: 'receiveBag',
      sellerId: identity.requestId,
      note: '',
    }
    expect(intakeCommand.safeParse(bag).success).toBe(true)
    expect(
      intakeCommand.safeParse({ ...bag, note: 'x'.repeat(501) }).success,
    ).toBe(false)
    expect(intakeCommand.safeParse({ ...bag, sellerId: '' }).success).toBe(
      false,
    )
  })
})
