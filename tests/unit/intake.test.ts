import { describe, expect, it } from 'vitest'
import { intakeCommand } from '../../lib/engine/intake'

const identity = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
}
describe('intake command boundary', () => {
  it('requires explicit publication policy and language and bounds legal text', () => {
    const input = {
      ...identity,
      action: 'publishAgreement',
      expectedCurrentId: null,
      title: 'Terms',
      body: 'Test terms',
      language: 'sv',
      required: true,
    }
    expect(intakeCommand.safeParse(input).success).toBe(true)
    expect(
      intakeCommand.safeParse({ ...input, required: 'true' }).success,
    ).toBe(false)
    expect(
      intakeCommand.safeParse({ ...input, language: 'unknown' }).success,
    ).toBe(false)
    expect(
      intakeCommand.safeParse({ ...input, body: 'x'.repeat(12001) }).success,
    ).toBe(false)
  })
  it('requires an identifiable external evidence reference', () => {
    const input = {
      ...identity,
      action: 'recordEvidence',
      sellerId: identity.requestId,
      agreementId: identity.requestId,
      reference: '  ',
    }
    expect(intakeCommand.safeParse(input).success).toBe(false)
    expect(
      intakeCommand.parse({ ...input, reference: ' Paper TEST-1 ' }),
    ).toMatchObject({ reference: 'Paper TEST-1' })
  })
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
