import { expect, it } from 'vitest'
import {
  scanStocktakeCommand,
  recordStocktakeFindingCommand,
  finishStocktakeCommand,
} from '../../lib/engine/stocktake'
const common = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
}
it('accepts item labels and full IDs, never arbitrary URLs or bag codes', () => {
  expect(
    scanStocktakeCommand.parse({
      ...common,
      action: 'scanStocktake',
      reference: ' i-ab123456 ',
    }).reference,
  ).toBe('I-AB123456')
  for (const reference of [
    'K-42',
    'https://untrusted.example/I-AB123456',
    'I-AB12',
    '',
    'I-AB123456;',
  ])
    expect(
      scanStocktakeCommand.safeParse({
        ...common,
        action: 'scanStocktake',
        reference,
      }).success,
    ).toBe(false)
  expect(
    scanStocktakeCommand.safeParse({
      ...common,
      action: 'scanStocktake',
      reference: common.requestId,
    }).success,
  ).toBe(true)
})
it('requires versioned explicit findings and a nonempty reason, without financial instructions', () => {
  const good = {
    ...common,
    action: 'recordStocktakeFinding',
    itemId: common.requestId,
    expectedVersion: 0,
    observation: 'missing',
    reason: 'Checked shelf',
  }
  expect(recordStocktakeFindingCommand.safeParse(good).success).toBe(true)
  for (const bad of [
    { ...good, reason: ' ' },
    { ...good, expectedVersion: -1 },
    { ...good, observation: 'sold' },
    { ...good, adjustBalance: true },
    { ...good, createdBy: common.requestId },
  ])
    expect(recordStocktakeFindingCommand.safeParse(bad).success).toBe(false)
  expect(
    finishStocktakeCommand.safeParse({ ...common, action: 'finishStocktake' })
      .success,
  ).toBe(false)
})
