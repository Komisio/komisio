import { describe, it, expect } from 'vitest'
import {
  guideAnswers,
  guideSteps,
  pricingOptions,
  type GuideAnswers,
} from '../../lib/engine/store-guide'
import { guideCopy } from '../../lib/guide-copy'
import { locales } from '../../lib/i18n'
const answers: GuideAnswers = {
  intake: ['bags'],
  goods: ['clothes'],
  pricing: ['store'],
  period: ['collect', 'donate'],
  pos: ['zettle'],
  channels: ['shop'],
}
describe('store guide', () => {
  it('keeps codes independent of all eight complete translations', () => {
    const reference = Object.keys(guideCopy('sv'))
    for (const locale of locales) {
      const c = guideCopy(locale)
      expect(Object.keys(c)).toEqual(reference)
      expect(
        Object.values(c).every((v) => typeof v === 'string' && v.length > 0),
      ).toBe(true)
      expect(guideAnswers.parse(answers)).toEqual(answers)
    }
  })
  it('rejects hidden, unknown, duplicate and contradictory answers', () => {
    for (const changed of [
      { intake: ['owned'] },
      { pos: ['invalid'] },
      { goods: ['clothes', 'clothes'] },
      { period: ['later', 'collect'] },
      { channels: ['later', 'web'] },
      { pricing: ['both'] },
    ])
      expect(guideAnswers.safeParse({ ...answers, ...changed }).success).toBe(
        false,
      )
  })
  it('adapts questions to owned stock and space rental', () => {
    const owned = { ...answers, intake: ['owned'], period: [] }
    expect(guideSteps(owned)).not.toContain('period')
    expect(guideAnswers.safeParse(owned).success).toBe(true)
    const rental = { ...owned, intake: ['space'], pricing: ['both'] }
    expect(pricingOptions(rental)).toContain('both')
    expect(guideAnswers.safeParse(rental).success).toBe(true)
  })
})
