import { describe, it, expect } from 'vitest'
import { bankDetails, bankCommand } from '../../lib/engine/seller-bank'
const details = {
  holder: 'Synthetic holder',
  country: 'SE',
  kind: 'iban',
  account: 'SE4550000000058398257466',
  routing: '',
}
describe('seller bank input', () => {
  it('checks IBAN country and checksum without numeric precision loss', () => {
    expect(bankDetails.safeParse(details).success).toBe(true)
    expect(
      bankDetails.safeParse({ ...details, account: 'SE4550000000058398257467' })
        .success,
    ).toBe(false)
    expect(bankDetails.safeParse({ ...details, country: 'NO' }).success).toBe(
      false,
    )
  })
  it('supports local details without assuming a Swedish clearing format', () => {
    expect(
      bankDetails.safeParse({
        ...details,
        country: 'US',
        kind: 'local',
        account: '1234567890',
        routing: '123456789',
      }).success,
    ).toBe(true)
    expect(
      bankDetails.safeParse({ ...details, country: 'ZZ', kind: 'local' })
        .success,
    ).toBe(false)
  })
  it('does not accept hidden metadata or account values in review commands', () => {
    expect(
      bankDetails.safeParse({ ...details, secret: 'hidden' }).success,
    ).toBe(false)
    const id = '30300000-0000-4000-8000-000000000001'
    expect(
      bankCommand.safeParse({
        action: 'review',
        tenantId: id,
        payoutId: id,
        requestId: id,
        version: id,
      }).success,
    ).toBe(true)
    expect(
      bankCommand.safeParse({
        action: 'review',
        tenantId: id,
        payoutId: id,
        requestId: id,
        version: id,
        details,
      }).success,
    ).toBe(false)
  })
})
