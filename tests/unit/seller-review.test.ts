import { it, expect } from 'vitest'
import { sellerResponseCommand } from '../../lib/engine/seller-review'
import { boundedJson } from '../../lib/http/bounded-json'
it('rejects claimed identity or authority in a seller response', () => {
  const c = {
    token: 'a'.repeat(64),
    requestId: crypto.randomUUID(),
    reviewId: crypto.randomUUID(),
    decision: 'approve',
  }
  expect(sellerResponseCommand.safeParse(c).success).toBe(true)
  expect(
    sellerResponseCommand.safeParse({ ...c, sellerId: crypto.randomUUID() })
      .success,
  ).toBe(false)
  expect(
    sellerResponseCommand.safeParse({ ...c, decision: 'publish' }).success,
  ).toBe(false)
})
it('bounds streamed input without trusting declared length', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: 'x'.repeat(4097),
  })
  await expect(boundedJson(request)).rejects.toThrow('INVALID_INPUT')
})
