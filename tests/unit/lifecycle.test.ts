import { expect, it } from 'vitest'
import {
  applyMarkdownCommand,
  extendSalePeriodCommand,
  endSalePeriodCommand,
} from '../../lib/engine/lifecycle'
import { intakeCommand } from '../../lib/engine/intake'

const ids = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  itemId: '33333333-3333-4333-8333-333333333333',
}

it('accepts the three lifecycle commands', () => {
  expect(
    intakeCommand.parse({ action: 'applyMarkdown', ...ids, step: 1 }).action,
  ).toBe('applyMarkdown')
  expect(
    extendSalePeriodCommand.parse({
      action: 'extendSalePeriod',
      ...ids,
      days: 14,
      reason: 'Seller on holiday',
    }).days,
  ).toBe(14)
  expect(
    endSalePeriodCommand.parse({
      action: 'endSalePeriod',
      ...ids,
      endAction: 'charity',
    }).note,
  ).toBe('')
})
it('bounds steps and days and requires a reason for an extension', () => {
  expect(
    applyMarkdownCommand.safeParse({ action: 'applyMarkdown', ...ids, step: 0 })
      .success,
  ).toBe(false)
  expect(
    extendSalePeriodCommand.safeParse({
      action: 'extendSalePeriod',
      ...ids,
      days: 400,
      reason: 'x',
    }).success,
  ).toBe(false)
  expect(
    extendSalePeriodCommand.safeParse({
      action: 'extendSalePeriod',
      ...ids,
      days: 7,
      reason: '  ',
    }).success,
  ).toBe(false)
  expect(
    endSalePeriodCommand.safeParse({
      action: 'endSalePeriod',
      ...ids,
      endAction: 'discard',
    }).success,
  ).toBe(false)
})
