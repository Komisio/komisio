import { describe, it, expect } from 'vitest'
import {
  initialSellerProfile,
  sellerProfileBody,
} from '../../lib/engine/seller-profile'
describe('seller profile boundaries', () => {
  const initial = initialSellerProfile({
    name: 'Synthetic',
    email: '',
    phone: '0700000000',
  })
  it('keeps optional profile fields empty for quick registrations', () => {
    expect(sellerProfileBody.parse(initial)).toEqual(initial)
    expect(initial.language).toBe('')
  })
  it('requires a contact path', () => {
    expect(sellerProfileBody.safeParse({ ...initial, phone: '' }).success).toBe(
      false,
    )
  })
  it('rejects unplanned identity and banking fields', () => {
    expect(
      sellerProfileBody.safeParse({ ...initial, ssn: '123' }).success,
    ).toBe(false)
    expect(
      sellerProfileBody.safeParse({ ...initial, bankAccount: '123' }).success,
    ).toBe(false)
  })
  it('rejects unsupported language and oversized notes', () => {
    expect(
      sellerProfileBody.safeParse({ ...initial, language: 'xx' }).success,
    ).toBe(false)
    expect(
      sellerProfileBody.safeParse({ ...initial, notes: 'x'.repeat(1001) })
        .success,
    ).toBe(false)
  })
})
