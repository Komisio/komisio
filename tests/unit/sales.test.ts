import { expect, it } from 'vitest'
import { recordSaleCommand } from '../../lib/engine/sales'
import { intakeCommand } from '../../lib/engine/intake'

const base = {
  action: 'recordSale',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  provider: 'manual',
  externalId: 'T-1',
  occurredAt: '2026-09-13T10:00:00Z',
  currency: 'SEK',
  lines: [{ itemId: '33333333-3333-4333-8333-333333333333', price: '250.00' }],
}

it('records a sale with exact decimal prices per line', () => {
  expect(intakeCommand.parse(base).action).toBe('recordSale')
  expect(recordSaleCommand.parse(base).lines[0].price).toBe('250.00')
})
it('rejects duplicate items, float prices, foreign currency and unknown providers', () => {
  for (const patch of [
    { lines: [...base.lines, ...base.lines] },
    { lines: [{ ...base.lines[0], price: '250' }] },
    { lines: [{ ...base.lines[0], price: 250 }] },
    { lines: [] },
    { currency: 'USD' },
    { provider: 'square' },
    { externalId: '' },
    { occurredAt: 'yesterday' },
  ])
    expect(
      recordSaleCommand.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})
