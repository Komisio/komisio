import { describe, expect, it } from 'vitest'
import { allowsRecipient } from '../../lib/platform/email-allowlist'

describe('outbound e-mail allowlist', () => {
  it('delivers to any recipient when the deployment is open', () => {
    expect(allowsRecipient('*', 'anyone@example.test')).toBe(true)
    expect(allowsRecipient(' * ', 'ANYONE@Example.Test')).toBe(true)
    expect(allowsRecipient('pilot@example.test,*', 'other@example.test')).toBe(
      true,
    )
  })
  it('keeps the exact list of a pilot deployment', () => {
    const list = 'pilot@example.test, second@example.test'
    expect(allowsRecipient(list, 'pilot@example.test')).toBe(true)
    expect(allowsRecipient(list, ' SECOND@example.test ')).toBe(true)
    expect(allowsRecipient(list, 'someone@example.test')).toBe(false)
  })
  it('fails closed when nothing is configured', () => {
    expect(allowsRecipient(undefined, 'anyone@example.test')).toBe(false)
    expect(allowsRecipient('', 'anyone@example.test')).toBe(false)
    expect(allowsRecipient('  ,  ', 'anyone@example.test')).toBe(false)
  })
  it('does not read a wildcard into a domain or a pattern', () => {
    expect(allowsRecipient('*@example.test', 'anyone@example.test')).toBe(false)
    expect(allowsRecipient('example.test', 'anyone@example.test')).toBe(false)
  })
})
