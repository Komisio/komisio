import { expect, it } from 'vitest'
import { setItemPriceCommand } from '@/lib/engine/lifecycle'
import { lifecycleBatchOperation } from '@/lib/engine/item-lifecycle-batch'
import { dictionary, locales } from '@/lib/i18n'
const id = '11111111-1111-4111-8111-111111111111'
it('human price changes accept omitted reasons without relaxing money or extension validation', () => {
  const command = {
    action: 'setItemPrice',
    tenantId: id,
    itemId: id,
    requestId: id,
    priceOre: 15000,
    expectedPriceOre: 20000,
  }
  expect(setItemPriceCommand.parse(command).reason).toBe('')
  for (const priceOre of [0, 1.5, 100000000000])
    expect(
      setItemPriceCommand.safeParse({ ...command, priceOre }).success,
    ).toBe(false)
  expect(
    lifecycleBatchOperation.parse({
      kind: 'setPrice',
      priceOre: 15000,
      reason: '',
    }),
  ).toMatchObject({ reason: '' })
  expect(
    lifecycleBatchOperation.safeParse({ kind: 'extend', days: 7, reason: '' })
      .success,
  ).toBe(false)
  expect(
    lifecycleBatchOperation.parse({
      kind: 'end',
      endAction: 'return',
      reason: 'Custom collection arrangement',
    }),
  ).toMatchObject({ reason: 'Custom collection arrangement' })
})
it.each(locales)('price controls have complete %s copy', (locale) => {
  for (const text of Object.values(dictionary(locale).priceEdit))
    expect(text.length).toBeGreaterThan(2)
})
