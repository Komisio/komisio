import { describe, it, expect } from 'vitest'
import { registrationCommand } from '../../lib/engine/seller-registration'
import { safeNext } from '../../lib/platform/validation'

describe('seller registration boundary', () => {
  const valid = {
    action: 'apply',
    token: 'a'.repeat(64),
    requestId: 'd3520000-0000-4000-8000-000000000001',
    name: 'Synthetic seller',
    phone: '+46700000000',
    agreementId: 'd3520000-0000-4000-8000-000000000002',
    translationId: null,
    accepted: true,
  }
  it('takes identity only from the verified session', () => {
    expect(registrationCommand.safeParse(valid).success).toBe(true)
    for (const extra of [
      { email: 'other@example.test' },
      { userId: valid.requestId },
      { tenantId: valid.requestId },
      { approved: true },
    ])
      expect(
        registrationCommand.safeParse({ ...valid, ...extra }).success,
      ).toBe(false)
  })
  it('requires explicit acceptance, bounded contacts and valid version references', () => {
    for (const patch of [
      { accepted: false },
      { name: ' ' },
      { phone: '' },
      { phone: 'x'.repeat(41) },
      { agreementId: null },
      { token: 'x' },
    ])
      expect(
        registrationCommand.safeParse({ ...valid, ...patch }).success,
      ).toBe(false)
  })
  it('preserves only exact same-application registration destinations through authentication', () => {
    const destination = '/join/' + 'a'.repeat(64)
    expect(safeNext(destination)).toBe(destination)
    for (const value of [
      destination + '?next=https://evil.test',
      destination + '/anything',
      destination + '#x',
      '//evil.test' + destination,
      '/join/%2f%2fevil.test',
      '/join/' + 'A'.repeat(64),
    ])
      expect(safeNext(value)).toBe('/')
  })
})
