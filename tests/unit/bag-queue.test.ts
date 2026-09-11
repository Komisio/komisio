import { describe, expect, it } from 'vitest'
import { bagQueueNavigation, bagQueueHref } from '../../lib/engine/bag-queue'

describe('bag queue navigation', () => {
  it('accepts printed bag references and exact numeric references', () => {
    for (const bag of ['123', 'K-123', ' k - 123 '])
      expect(bagQueueNavigation.parse({ bag }).bag).toBe(123)
    expect(bagQueueNavigation.parse({ bag: '' }).bag).toBe('')
  })
  it('rejects ambiguous, unsafe and injected cursors', () => {
    for (const input of [
      { older: '1', newer: '2' },
      { older: '0' },
      { older: '9007199254740992' },
      { older: '1e3' },
      { bag: '1.or.true' },
      { bag: ['1', '2'] },
      { seller: 'not-an-id' },
    ])
      expect(bagQueueNavigation.safeParse(input).success).toBe(false)
  })
  it('preserves a selected seller and search when moving between pages', () => {
    expect(
      bagQueueHref({
        seller: '10000000-0000-4000-8000-000000000001',
        bag: 123,
        older: 124,
        newer: undefined,
      }),
    ).toBe(
      '/intake?seller=10000000-0000-4000-8000-000000000001&bag=123&older=124#bag-queue',
    )
  })
})
