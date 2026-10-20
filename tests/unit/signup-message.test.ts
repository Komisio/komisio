import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dictionary, locales } from '../../lib/i18n'
import {
  signupBlockedMessage,
  signupMessageLocale,
} from '../../lib/platform/signup-message'
import { proxy } from '../../proxy'

afterEach(() => vi.unstubAllEnvs())
describe('localized blocked signup', () => {
  it('uses cookie, valid lang, first supported browser language, then English', () => {
    expect(
      signupMessageLocale({ cookie: 'fi', lang: 'sv', acceptLanguage: 'en' }),
    ).toBe('fi')
    expect(
      signupMessageLocale({
        cookie: 'invalid',
        lang: 'dk',
        acceptLanguage: 'en',
      }),
    ).toBe('dk')
    expect(
      signupMessageLocale({
        cookie: 'invalid',
        lang: 'invalid',
        acceptLanguage: 'fr, de-DE;q=0.8,sv;q=0.7',
      }),
    ).toBe('de')
    expect(signupMessageLocale({ acceptLanguage: 'sv;q=0,en;q=0.9' })).toBe(
      'en',
    )
    expect(signupMessageLocale({ acceptLanguage: 'nb-NO' })).toBe('no')
    expect(signupMessageLocale({ acceptLanguage: 'da-DK' })).toBe('dk')
    expect(signupMessageLocale({ acceptLanguage: 'fr,*' })).toBe('en')
    expect(signupMessageLocale({})).toBe('en')
  })
  it.each(locales)(
    'keeps the blocked plain-text response and configured support in %s',
    async (locale) => {
      vi.stubEnv('KOMISIO_BLOCKED_SIGNUP_COUNTRIES', 'XX')
      vi.stubEnv('KOMISIO_SUPPORT_EMAIL', 'operator@example.test')
      const response = await proxy(
        new NextRequest('https://app.example.test/register?lang=en', {
          headers: {
            'x-vercel-ip-country': 'XX',
            cookie: `komisio-locale=${locale}`,
          },
        }),
      )
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toBe(
        'text/plain; charset=utf-8',
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toBe(
        dictionary(locale).errors.signupBlocked.replace(
          '{email}',
          'operator@example.test',
        ),
      )
    },
  )
  it('falls back to English and the default support address', () => {
    expect(signupBlockedMessage({}, { KOMISIO_SUPPORT_EMAIL: 'bad' })).toBe(
      dictionary('en').errors.signupBlocked.replace(
        '{email}',
        'support@komisio.com',
      ),
    )
  })
})
