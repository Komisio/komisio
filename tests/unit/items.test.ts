import { expect, it } from 'vitest'
import { acceptItemCommand } from '../../lib/engine/items'
import { intakeCommand } from '../../lib/engine/intake'

const base = {
  action: 'acceptItem',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  originId: '33333333-3333-4333-8333-333333333333',
}

it('accepts each origin with the revision rule that matches it', () => {
  expect(
    intakeCommand.parse({
      ...base,
      originKind: 'inspection_draft',
      originRevision: 3,
      price: '250.00',
    }).action,
  ).toBe('acceptItem')
  expect(
    acceptItemCommand.parse({
      ...base,
      originKind: 'reception_review',
      originRevision: 1,
      price: '0.50',
    }).originRevision,
  ).toBe(1)
  expect(
    acceptItemCommand.parse({
      ...base,
      originKind: 'purchase',
      originRevision: null,
      price: '150.00',
    }).originRevision,
  ).toBe(null)
})
it('rejects mismatched revisions, float-shaped prices and unknown origins', () => {
  for (const patch of [
    { originKind: 'purchase', originRevision: 1, price: '1.00' },
    { originKind: 'inspection_draft', originRevision: null, price: '1.00' },
    { originKind: 'inspection_draft', originRevision: 0, price: '1.00' },
    { originKind: 'inspection_draft', originRevision: 1, price: '1' },
    { originKind: 'inspection_draft', originRevision: 1, price: '1.5' },
    { originKind: 'inspection_draft', originRevision: 1, price: 1.5 },
    { originKind: 'sale', originRevision: 1, price: '1.00' },
  ])
    expect(
      acceptItemCommand.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})
