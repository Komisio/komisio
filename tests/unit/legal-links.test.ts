import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { legalPages, legalUrl } from '../../lib/platform/legal'
import { dictionary, locales } from '../../lib/i18n'
import { LegalLinks } from '../../components/platform/legal-links'
import { AuthForm } from '../../components/auth/auth-form'
import { AdsConsentControl } from '../../components/platform/ads-consent'
import { BillingActions } from '../../components/platform/billing-actions'
import { AiCreditsPanel } from '../../components/platform/ai-credits-panel'
import Register from '../../app/(auth)/register/page'

afterEach(() => vi.unstubAllEnvs())

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/register',
}))
vi.mock('@/lib/platform/ads-measurement', async (original) => ({
  ...(await original<typeof import('../../lib/platform/ads-measurement')>()),
  adsConfiguration: () => ({ tag: 'AW-123', destination: 'AW-123/synthetic' }),
}))

const baseUrl = 'https://komisio.com'
it('does not serialize a misconfigured credential-bearing URL into public registration props', async () => {
  vi.stubEnv('KOMISIO_LEGAL_BASE_URL', 'https://user:secret@example.test')
  const page = await Register({
    searchParams: Promise.resolve({ locale: 'en' }),
  })
  expect(page.props.legalBaseUrl).toBeUndefined()
})
it.each(locales)(
  'builds and renders all legal destinations in %s',
  (locale) => {
    const d = dictionary(locale)
    for (const page of legalPages) {
      expect(legalUrl(locale, page, baseUrl)).toBe(
        `${baseUrl}/${locale}/${page}/`,
      )
      expect(d.legal[page].trim()).not.toBe('')
    }
    const register = renderToStaticMarkup(
      createElement(AuthForm, {
        mode: 'register',
        initialLocale: locale,
        legalBaseUrl: baseUrl,
      }),
    )
    for (const page of ['terms', 'privacy', 'dpa'])
      expect(register).toContain(`href="${baseUrl}/${locale}/${page}/"`)
    expect(register).not.toContain('type="checkbox"')
    const ads = renderToStaticMarkup(
      createElement(AdsConsentControl, { d, locale, legalBaseUrl: baseUrl }),
    )
    expect(ads).toContain(`href="${baseUrl}/${locale}/privacy/"`)
    const links = renderToStaticMarkup(
      createElement(LegalLinks, { locale, baseUrl, d: d.legal }),
    )
    expect(links.match(/target="_blank"/g)).toHaveLength(3)
    expect(links.match(/rel="noopener noreferrer"/g)).toHaveLength(3)
  },
)

it.each([
  undefined,
  '',
  ' ',
  'not-a-url',
  'javascript:alert(1)',
  'data:text/html,test',
  'https://user:password@example.test',
  'https://example.test?key=value',
  'https://example.test#terms',
])(
  'hides documents for unset or invalid operator configuration: %s',
  (baseUrl) => {
    expect(legalUrl('dk', 'terms', baseUrl)).toBeNull()
    const d = dictionary('dk')
    expect(
      renderToStaticMarkup(
        createElement(LegalLinks, { locale: 'dk', baseUrl, d: d.legal }),
      ),
    ).toBe('')
    const register = renderToStaticMarkup(
      createElement(AuthForm, { mode: 'register', legalBaseUrl: baseUrl }),
    )
    expect(register).not.toContain('href="https://komisio.com')
    expect(register).not.toContain('class="legal-links"')
    expect(
      renderToStaticMarkup(
        createElement(AdsConsentControl, {
          d,
          locale: 'dk',
          legalBaseUrl: baseUrl,
        }),
      ),
    ).not.toContain('<a ')
  },
)

it('retains an operator path, normalizes slashes and falls back to English for an unsupported locale', () => {
  expect(legalUrl('dk', 'dpa', ' https://operator.example/documents/// ')).toBe(
    'https://operator.example/documents/dk/dpa/',
  )
  expect(legalUrl('da', 'terms', 'http://localhost:8080/legal')).toBe(
    'http://localhost:8080/legal/en/terms/',
  )
})

it('renders pricing and terms next to both purchase controls without changing their price or action', () => {
  const d = dictionary('en')
  const purchaseLinks = createElement(LegalLinks, {
    locale: 'en',
    baseUrl,
    d: d.legal,
    pricing: true,
  })
  const billing = renderToStaticMarkup(
    createElement(BillingActions, {
      tenantId: 'synthetic',
      status: { state: 'trial', billing: true, writable: true },
      configured: true,
      outcome: null,
      d: d.plans,
      purchaseLinks,
    }),
  )
  const credits = renderToStaticMarkup(
    createElement(AiCreditsPanel, {
      tenantId: 'synthetic',
      locale: 'en',
      d: d.credits,
      canManage: false,
      canBuy: true,
      price: { currency: 'EUR', amountMinor: 900 },
      state: {
        enabled: true,
        period: '2026-10',
        includedOre: 10000,
        includedLeftOre: 10000,
        purchasedLeftOre: 0,
        usedThisPeriodOre: 0,
        packOre: 10000,
        ownKey: false,
        ownModel: null,
        capReached: false,
        estimatedItemsPerMonth: 4000,
      },
      purchaseLinks,
    }),
  )
  for (const html of [billing, credits]) {
    expect(html).toContain('href="https://komisio.com/en/pricing/"')
    expect(html).toContain('href="https://komisio.com/en/terms/"')
    expect(html).toContain('<button')
  }
})
