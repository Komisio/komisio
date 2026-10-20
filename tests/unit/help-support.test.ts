import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ContactSupport,
  HelpSupportProvider,
} from '../../components/help/contact-support'
import { dictionary, locales } from '../../lib/i18n'
import {
  supportConfig,
  supportMail,
  supportPage,
  supportVersion,
} from '../../lib/help/support'
import { searchHelp } from '../../lib/help/search'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams('tab=printing&token=secret'),
}))

describe('support configuration and privacy', () => {
  it.each(locales)(
    'renders the configured contact and safe new-tab link in %s',
    (locale) => {
      const d = dictionary(locale).helpCenter.support
      const render = (url?: string) =>
        renderToStaticMarkup(
          createElement(
            HelpSupportProvider,
            {
              value: {
                ...supportConfig({
                  KOMISIO_SUPPORT_EMAIL: 'help@example.test',
                  KOMISIO_SUPPORT_URL: url,
                }),
                storeName: 'Synthetic store',
                tenantId: '10000000-0000-4000-8000-000000000001',
                locale,
                version: '0.1.0',
              },
            },
            createElement(ContactSupport, { d }),
          ),
        )
      const html = render('https://help.example.test/support')
      expect(html).toContain('mailto:help@example.test?')
      expect(html).toContain(
        'href="https://help.example.test/support" target="_blank" rel="noreferrer"',
      )
      expect(html).toContain('help@example.test</p>')
      expect(html).not.toContain('token')
      expect(render('http://help.example.test')).not.toContain(
        'target="_blank"',
      )
    },
  )
  it.each([
    undefined,
    '',
    ' ',
    'bad',
    'one@example.test,two@example.test',
    'A <a@example.test>',
    'a@example.test\r\nBcc:b@example.test',
    'a@example.test?subject=token',
  ])('uses the default for invalid single addresses: %s', (email) => {
    expect(supportConfig({ KOMISIO_SUPPORT_EMAIL: email }).email).toBe(
      'support@komisio.com',
    )
  })
  it('accepts an operator address and only credential-free absolute HTTPS support links', () => {
    expect(
      supportConfig({
        KOMISIO_SUPPORT_EMAIL: ' help+store@example.test ',
        KOMISIO_SUPPORT_URL: 'https://support.example.test/help',
      }),
    ).toEqual({
      email: 'help+store@example.test',
      url: 'https://support.example.test/help',
    })
    for (const url of [
      '',
      '/help',
      'http://example.test',
      'javascript:alert(1)',
      'mailto:a@example.test',
      'https://user:secret@example.test',
    ])
      expect(supportConfig({ KOMISIO_SUPPORT_URL: url }).url).toBeNull()
  })
  it('redacts dynamic segments and accepts query values only on their actual pages', () => {
    expect(
      supportPage(
        '/intake/sellers/secret-seller/privacy?token=secret#cookie',
        'token',
        'token',
      ),
    ).toBe('/intake/sellers/[id]/privacy')
    expect(supportPage('/intake/items/secret-item')).toBe('/intake/items/[id]')
    expect(supportPage('/settings', 'settings', 'printing')).toBe(
      '/settings?tab=printing',
    )
    expect(
      supportPage('/intake/accounting', 'reconciliation', 'printing'),
    ).toBe('/intake/accounting?view=reconciliation')
    expect(supportPage('/intake/submissions', 'registered')).toBe(
      '/intake/submissions?view=registered',
    )
    expect(supportPage('/unknown/secret-token')).toBe('/[page]')
    expect(supportPage('/members', 'secret@example.test', 'cookie')).toBe(
      '/members',
    )
    expect(supportPage('/')).toBe('/')
  })
  it('constructs a bounded version from public package version and commit only', () => {
    expect(supportVersion('0.1.0', 'abcdef0123456789')).toBe('0.1.0+abcdef0')
    expect(supportVersion('0.1.0')).toBe('0.1.0')
    expect(supportVersion('0.1.0', 'not-a-commit')).toBe('0.1.0')
  })
  it.each(locales)(
    'builds a private bounded email in %s even with long Unicode names',
    (locale) => {
      const context = {
        ...supportConfig({}),
        storeName: '店😀'.repeat(5000),
        tenantId: '10000000-0000-4000-8000-000000000001',
        locale,
        version: '0.1.0+abcdef0',
        userEmail: 'private@example.test',
        cookies: 'secret-cookie',
        role: 'owner',
      }
      const mail = supportMail(
        context,
        {
          pathname:
            '/intake/sellers/secret-id/privacy?email=private@example.test#secret-cookie',
          view: 'secret-token',
          tab: 'private@example.test',
        },
        dictionary(locale).helpCenter.support,
      )
      expect(mail.href.length).toBeLessThan(2000)
      expect(mail.body).toContain(context.tenantId)
      expect(mail.body).toContain('/intake/sellers/[id]/privacy')
      expect(mail.body).toContain('0.1.0+abcdef0')
      expect(mail.body).toContain(locale)
      expect(mail.body).toContain('店😀')
      for (const secret of [
        'secret-id',
        'secret-token',
        'secret-cookie',
        'private@example.test',
        'owner',
      ])
        expect(mail.href + mail.body).not.toContain(secret)
      expect(new URL(mail.href).searchParams.get('body')).toBe(mail.body)
    },
  )
})

describe('browser-only help search', () => {
  it.each(['title', 'intro', 'steps', 'notice'] as const)(
    'searches %s without case or diacritics',
    (field) => {
      const d = structuredClone(dictionary('sv').helpCenter)
      const article = d.articles.receiving
      if (field === 'steps') article.steps = ['Unik SÄKERHET']
      else article[field] = 'Unik SÄKERHET'
      expect(searchHelp(d, 'unik sakerhet')).toEqual(['receiving'])
    },
  )
  it('uses only supplied locale articles and handles empty queries and no matches', () => {
    const d = dictionary('en').helpCenter
    expect(searchHelp(d, '   ')).toHaveLength(7)
    expect(searchHelp(d, 'nonexistent-article-phrase')).toEqual([])
    expect(searchHelp(d, d.articles.labels.title)).toContain('labels')
  })
})
