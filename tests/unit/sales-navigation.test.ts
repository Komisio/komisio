import { expect, it } from 'vitest'
import {
  receiptSearch,
  receiptSearchQuery,
} from '../../lib/intake/sales-navigation'

it('retains exact references safely while discarding unrelated return destinations', () => {
  const reference = 'A & B / 51?next=https://example.test'
  const query = receiptSearchQuery({
    reference,
    provider: 'manual',
    next: 'https://example.test',
  })
  expect(new URLSearchParams(query).get('reference')).toBe(reference)
  expect(new URLSearchParams(query).get('provider')).toBe('manual')
  expect(new URLSearchParams(query).has('next')).toBe(false)
  expect(receiptSearchQuery({ reference: '  ', provider: '' })).toBe('')
})
it('rejects unsupported or repeated filter values and oversized references', () => {
  for (const input of [
    { provider: 'unknown' },
    { provider: ['manual'] },
    { reference: ['a', 'b'] },
    { reference: 'a'.repeat(201) },
  ])
    expect(receiptSearch.safeParse(input).success).toBe(false)
})
