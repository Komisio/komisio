import { describe, expect, it } from 'vitest'
import {
  dictionary,
  intlLocale,
  isLocale,
  localeNames,
  locales,
  messageLocale,
  resolveLocale,
} from '../../lib/i18n'
import { renderSellerMessage } from '../../lib/communications/templates'

describe('eight product languages', () => {
  it('lists the same languages as komisio.com with a name and an Intl tag each', () => {
    expect([...locales]).toEqual([
      'sv',
      'en',
      'no',
      'dk',
      'fi',
      'de',
      'es',
      'it',
    ])
    for (const code of locales) {
      expect(localeNames[code]).toBeTruthy()
      expect(intlLocale(code)).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
      expect(
        new Intl.DateTimeFormat(intlLocale(code)).resolvedOptions().locale,
      ).toContain(code === 'no' ? 'nb' : code === 'dk' ? 'da' : code)
    }
  })
  it('resolves the cookie first, then the profile, then Swedish', () => {
    expect(resolveLocale('de', 'en')).toBe('de')
    expect(resolveLocale(undefined, 'fi')).toBe('fi')
    expect(resolveLocale('pt', 'xx')).toBe('sv')
    expect(isLocale('it')).toBe(true)
    expect(isLocale('IT')).toBe(false)
    expect(dictionary('es').login).not.toBe(dictionary('sv').login)
    expect(dictionary('nope')).toBe(dictionary('sv'))
  })
  it('sends the fixed e-mail templates in Swedish or English only', () => {
    expect(messageLocale('sv')).toBe('sv')
    expect(messageLocale('de')).toBe('en')
    const facts = {
      storeName: 'Laden',
      sellerName: 'Anna',
      freeText: '',
    }
    expect(renderSellerMessage('message', 'de', facts).body).toEqual(
      renderSellerMessage('message', 'en', facts).body,
    )
  })
})
