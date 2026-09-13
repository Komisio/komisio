import { expect, it } from 'vitest'
import {
  adjustLedgerPayload,
  applyMarkdownBatchPayload,
  approvePayoutPayload,
  bulkItemUpdatePayload,
  exportDayClosePayload,
  markPayoutPaidPayload,
  proposeOperationCommand,
  recordReturnPayload,
  sendMessagePayload,
  settlePayoutsPayload,
} from '../../lib/engine/operations'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'

it('return: full refund of one line with a reason', () => {
  expect(
    recordReturnPayload.safeParse({
      saleLineId: a,
      refundOre: 20000,
      reason: 'x',
    }).success,
  ).toBe(true)
  for (const bad of [
    { saleLineId: a, refundOre: 0, reason: 'x' },
    { saleLineId: a, refundOre: 20000, reason: ' ' },
    { saleLineId: a, refundOre: 20000, reason: 'x', extra: 1 },
  ])
    expect(recordReturnPayload.safeParse(bad).success).toBe(false)
})

it('ledger adjustment: signed, never zero, reason required', () => {
  expect(
    adjustLedgerPayload.safeParse({
      sellerId: a,
      amountOre: -500,
      reason: 'fee',
    }).success,
  ).toBe(true)
  expect(
    adjustLedgerPayload.safeParse({ sellerId: a, amountOre: 0, reason: 'fee' })
      .success,
  ).toBe(false)
})

it('markdown batch and bulk update: each item once, bounded size', () => {
  expect(
    applyMarkdownBatchPayload.safeParse({
      items: [
        { itemId: a, step: 1 },
        { itemId: a, step: 2 },
      ],
    }).success,
  ).toBe(false)
  expect(
    bulkItemUpdatePayload.safeParse({
      action: 'setPrice',
      reason: 'sale',
      items: [
        { itemId: a, priceOre: 100 },
        { itemId: b, priceOre: 200 },
      ],
    }).success,
  ).toBe(true)
  expect(
    bulkItemUpdatePayload.safeParse({
      action: 'endPeriod',
      endAction: 'burn',
      note: '',
      items: [{ itemId: a }],
    }).success,
  ).toBe(false)
  expect(
    bulkItemUpdatePayload.safeParse({
      action: 'setPrice',
      reason: 'sale',
      items: Array.from({ length: 51 }, (_, i) => ({
        itemId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
        priceOre: 100,
      })),
    }).success,
  ).toBe(false)
})

it('payouts: approval takes a reason key, payment needs a reference', () => {
  expect(
    approvePayoutPayload.safeParse({ payoutId: a, reason: '' }).success,
  ).toBe(true)
  expect(approvePayoutPayload.safeParse({ payoutId: a }).success).toBe(false)
  expect(
    markPayoutPaidPayload.safeParse({ payoutId: a, reference: ' ', reason: '' })
      .success,
  ).toBe(false)
  expect(
    markPayoutPaidPayload.safeParse({
      payoutId: a,
      reference: 'BG 1',
      reason: '',
    }).success,
  ).toBe(true)
})

it('message: seller, locale and free text only; export: one day close', () => {
  expect(
    sendMessagePayload.safeParse({
      sellerId: a,
      locale: 'sv',
      freeText: ' Hej ',
    }).data?.freeText,
  ).toBe('Hej')
  expect(
    sendMessagePayload.safeParse({
      sellerId: a,
      locale: 'sv',
      freeText: 'Hej',
      subject: 'no',
    }).success,
  ).toBe(false)
  expect(exportDayClosePayload.safeParse({ dayCloseId: a }).success).toBe(true)
  expect(exportDayClosePayload.safeParse({ dayCloseId: 'x' }).success).toBe(
    false,
  )
})

it('settlement: each seller once, positive öre, a note, at most 100 rows', () => {
  expect(
    settlePayoutsPayload.safeParse({
      sellers: [
        { sellerId: a, amountOre: 10000 },
        { sellerId: b, amountOre: 25050 },
      ],
      reason: 'September settlement',
    }).success,
  ).toBe(true)
  for (const bad of [
    { sellers: [], reason: 'x' },
    { sellers: [{ sellerId: a, amountOre: 10000 }], reason: ' ' },
    { sellers: [{ sellerId: a, amountOre: 0 }], reason: 'x' },
    { sellers: [{ sellerId: a, amountOre: 10.5 }], reason: 'x' },
    {
      sellers: [
        { sellerId: a, amountOre: 1 },
        { sellerId: a, amountOre: 2 },
      ],
      reason: 'x',
    },
    { sellers: [{ sellerId: a, amountOre: 1, note: 'no' }], reason: 'x' },
    {
      sellers: Array.from({ length: 101 }, (_, i) => ({
        sellerId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
        amountOre: 10000,
      })),
      reason: 'x',
    },
  ])
    expect(settlePayoutsPayload.safeParse(bad).success).toBe(false)
})

it('the propose command binds each kind to its own payload', () => {
  const base = {
    tenantId: a,
    requestId: b,
    actorLabel: 'agent',
    expiresAt: '2026-09-14T10:00:00Z',
  }
  expect(
    proposeOperationCommand.safeParse({
      ...base,
      kind: 'exportDayClose',
      payload: { dayCloseId: a },
    }).success,
  ).toBe(true)
  expect(
    proposeOperationCommand.safeParse({
      ...base,
      kind: 'exportDayClose',
      payload: { payoutId: a, reason: '' },
    }).success,
  ).toBe(false)
  expect(
    proposeOperationCommand.safeParse({
      ...base,
      kind: 'notAKind',
      payload: {},
    }).success,
  ).toBe(false)
})
