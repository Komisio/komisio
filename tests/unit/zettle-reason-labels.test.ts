import { expect, it } from 'vitest'
import { dictionary, locales } from '../../lib/i18n'
import { blockedPurchaseReason } from '../../extensions/zettle/purchase'

it.each(locales)('explains every held purchase reason in %s', (locale) => {
  const d = dictionary(locale).zettle
  for (const reason of blockedPurchaseReason.options) {
    expect(d.blockedReasons[reason].trim().length).toBeGreaterThan(20)
    expect(d.blockedReasons[reason]).not.toBe(reason)
  }
  expect(d.diagnosticReason.trim()).not.toBe('')
})
