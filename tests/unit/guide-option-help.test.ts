import { describe, expect, it } from 'vitest'
import { locales } from '../../lib/i18n'
import { guideOptions } from '../../lib/engine/store-guide'
import { guideOptionHelp } from '../../lib/guide-option-help'

describe('store guide option help', () => {
  it.each(locales)(
    'covers every choice and rental checkout in %s',
    (locale) => {
      const help = guideOptionHelp(locale)
      for (const [step, options] of Object.entries(guideOptions)) {
        const descriptions = help.descriptions[
          step as keyof typeof guideOptions
        ] as Record<string, string>
        for (const option of options)
          expect(descriptions[option]?.length).toBeGreaterThan(15)
      }
      expect(Object.keys(help.checkout)).toEqual([
        'store',
        'seller',
        'both',
        'later',
      ])
      expect(help.checkout.store).not.toBe(help.descriptions.pricing.store)
      expect(help.label.length).toBeGreaterThan(3)
    },
  )
})
