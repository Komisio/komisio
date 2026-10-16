import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  marketingConsentEnabled,
  signupMarketingMetadata,
} from '../../lib/platform/marketing-consent'
import { AuthForm } from '../../components/auth/auth-form'
import { MarketingConsentForm } from '../../components/platform/marketing-consent-form'
import { dictionary, locales } from '../../lib/i18n'

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/register',
}))
afterEach(() => vi.unstubAllEnvs())
it.each(['', 'false', '1', 'TRUE'])(
  'disabled unless explicitly true: %s',
  (value) => {
    vi.stubEnv('KOMISIO_MARKETING_CONSENT_ENABLED', value)
    expect(marketingConsentEnabled()).toBe(false)
    expect(signupMarketingMetadata(false, true)).toEqual({})
    expect(
      renderToStaticMarkup(
        createElement(AuthForm, {
          mode: 'register',
          marketingConsent: marketingConsentEnabled(),
        }),
      ),
    ).not.toContain('name="marketingConsent"')
  },
)
it('records an explicit unchecked choice separately from no choice', () => {
  vi.stubEnv('KOMISIO_MARKETING_CONSENT_ENABLED', 'true')
  expect(marketingConsentEnabled()).toBe(true)
  expect(signupMarketingMetadata(true, false)).toEqual({
    marketing_consent: false,
    marketing_consent_version: 'product-news-v1',
  })
  expect(signupMarketingMetadata(true, true).marketing_consent).toBe(true)
})
it.each(locales)(
  'signup is optional and unchecked in %s; account withdrawal remains available when disabled',
  (locale) => {
    const html = renderToStaticMarkup(
      createElement(AuthForm, {
        mode: 'register',
        initialLocale: locale,
        marketingConsent: true,
      }),
    )
    const input = html.match(/<input[^>]*name="marketingConsent"[^>]*>/)?.[0]
    expect(input).toBeDefined()
    expect(input).not.toMatch(/checked|\srequired/)
    expect(html).toContain(dictionary(locale).marketingConsentLabel)
    const account = renderToStaticMarkup(
      createElement(MarketingConsentForm, {
        d: dictionary(locale),
        consented: true,
        enabled: false,
      }),
    )
    expect(account).toContain(dictionary(locale).marketingConsentWithdraw)
    expect(account).not.toContain('name="marketingConsent"')
    expect(
      renderToStaticMarkup(
        createElement(AuthForm, { mode: 'login', marketingConsent: true }),
      ),
    ).not.toContain('name="marketingConsent"')
  },
)
