import { describe, expect, it } from 'vitest'
import { dictionary, type Locale } from '../../lib/i18n'
import {
  assistanceErrorMessage,
  assistanceShownMessage,
} from '../../lib/assistance/messages'

const locales: Locale[] = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']
const RAW = 'Rate limit exceeded for model gpt (provider-internal-id-123)'

describe('assistanceErrorMessage', () => {
  it.each(locales)('maps every known code to its %s text', (locale) => {
    const d = dictionary(locale).reception
    expect(assistanceErrorMessage('ASSISTANCE_LIMIT', d)).toBe(d.aiLimit)
    expect(assistanceErrorMessage('USAGE_QUOTA_EXCEEDED', d)).toBe(d.aiQuota)
    expect(assistanceErrorMessage('AI_CREDITS_EXHAUSTED', d)).toBe(d.aiCredits)
    expect(assistanceErrorMessage('AI_CAP_REACHED', d)).toBe(d.aiCap)
    for (const text of [d.aiLimit, d.aiQuota, d.aiCredits, d.aiCap])
      expect(text).not.toBe(d.aiFailed)
  })
  it.each([
    'ASSISTANCE_FAILED',
    'ASSISTANCE_ALREADY_ATTEMPTED',
    'RECEPTION_CHANGED',
    'FORBIDDEN',
    RAW,
    '',
    undefined,
    null,
    42,
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
  ])('turns %j into the generic text', (code) => {
    const d = dictionary('sv').reception
    expect(assistanceErrorMessage(code, d)).toBe(d.aiFailed)
  })
})

describe('assistanceShownMessage', () => {
  it.each(locales)(
    'shows only the translated texts verbatim in %s',
    (locale) => {
      const d = dictionary(locale).reception
      for (const text of [
        d.aiLimit,
        d.aiQuota,
        d.aiCredits,
        d.aiCap,
        d.aiUnavailable,
      ])
        expect(assistanceShownMessage(new Error(text), d)).toBe(text)
    },
  )
  it('never discloses a provider or runtime message', () => {
    const d = dictionary('sv').reception
    for (const thrown of [
      new Error(RAW),
      new Error(''),
      new TypeError('fetch failed'),
      RAW,
      { message: d.aiQuota },
      null,
    ]) {
      const shown = assistanceShownMessage(thrown, d)
      expect(shown).toBe(d.aiFailed)
      expect(shown).not.toContain('provider-internal')
    }
  })
  it('does not show a text from another locale verbatim', () => {
    const sv = dictionary('sv').reception
    const en = dictionary('en').reception
    expect(assistanceShownMessage(new Error(en.aiQuota), sv)).toBe(sv.aiFailed)
  })
})
