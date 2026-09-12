import { expect, it } from 'vitest'
import {
  proposeOperationCommand,
  acceptItemPayload,
  operationErrorCode,
} from '../../lib/engine/operations'
import { proposeAcceptanceInput } from '../../mcp/items'

const base = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  actorLabel: 'komisio-mcp',
  expiresAt: '2026-09-14T10:00:00Z',
}
const origin = '33333333-3333-4333-8333-333333333333'

it('stages acceptance with an integer öre price and the origin revision rule', () => {
  expect(
    proposeOperationCommand.parse({
      ...base,
      kind: 'acceptItem',
      payload: {
        originKind: 'reception_review',
        originId: origin,
        originRevision: 1,
        priceOre: 32000,
      },
    }).kind,
  ).toBe('acceptItem')
  expect(
    acceptItemPayload.parse({
      originKind: 'purchase',
      originId: origin,
      originRevision: null,
      priceOre: 25000,
    }).originRevision,
  ).toBe(null)
  expect(
    proposeAcceptanceInput.parse({
      requestId: base.requestId,
      expiresAt: base.expiresAt,
      originKind: 'inspection_draft',
      originId: origin,
      originRevision: 2,
      priceOre: 9900,
    }).requestId,
  ).toBe(base.requestId)
})
it('rejects float prices, mismatched revisions and unknown keys', () => {
  for (const payload of [
    {
      originKind: 'purchase',
      originId: origin,
      originRevision: 1,
      priceOre: 1,
    },
    {
      originKind: 'inspection_draft',
      originId: origin,
      originRevision: null,
      priceOre: 1,
    },
    {
      originKind: 'inspection_draft',
      originId: origin,
      originRevision: 1,
      priceOre: 0,
    },
    {
      originKind: 'inspection_draft',
      originId: origin,
      originRevision: 1,
      priceOre: 12.5,
    },
    {
      originKind: 'inspection_draft',
      originId: origin,
      originRevision: 1,
      priceOre: '12500',
    },
    {
      originKind: 'inspection_draft',
      originId: origin,
      originRevision: 1,
      priceOre: 100,
      price: '1.00',
    },
  ])
    expect(
      acceptItemPayload.safeParse(payload).success,
      JSON.stringify(payload),
    ).toBe(false)
})
it('maps acceptance error codes for hosts', () => {
  for (const code of [
    'ITEM_EXISTS',
    'CUSTODY_REQUIRED',
    'SELLER_APPROVAL_REQUIRED',
    'PRICE_NOT_APPROVED',
    'AGREEMENT_REQUIRED',
    'ORIGIN_NOT_FOUND',
  ])
    expect(operationErrorCode(`boom ${code} here`)).toBe(code)
})
