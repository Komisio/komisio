import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
import { HelpArticle } from '../../components/help/article'
import { helpCatalog } from '../../lib/help/content'
import { dictionary } from '../../lib/i18n'
import { useHelpContent } from '../../components/help/content-provider'
vi.mock('../../components/help/content-provider', () => ({
  useHelpContent: vi.fn(),
}))
vi.mock('../../components/help/article-feedback', () => ({
  ArticleFeedback: () => null,
}))
vi.mock('../../components/platform/navigation-warning', () => ({
  NavigationLink: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}))

describe('help rendering language and links', () => {
  it('announces missing and machine translations independently', () => {
    const articles = helpCatalog('fi')
    vi.mocked(useHelpContent).mockReturnValue({
      tenantId: 'synthetic',
      locale: 'fi',
      articles,
    })
    const fallback = renderToStaticMarkup(
      createElement(HelpArticle, {
        topic: 'members-roles',
        d: dictionary('fi').helpCenter,
      }),
    )
    expect(fallback).toContain(dictionary('fi').helpCenter.fallbackNote)
    expect(fallback).toContain('lang="en"')
    expect(fallback).not.toContain(
      dictionary('fi').helpCenter.machineTranslationNote,
    )
    articles['members-roles'] = {
      ...articles['members-roles'],
      fallback: false,
      sourceLocale: 'fi',
      machineTranslated: true,
    }
    const translated = renderToStaticMarkup(
      createElement(HelpArticle, {
        topic: 'members-roles',
        d: dictionary('fi').helpCenter,
      }),
    )
    expect(translated).toContain(
      dictionary('fi').helpCenter.machineTranslationNote,
    )
    expect(translated).not.toContain(dictionary('fi').helpCenter.fallbackNote)
    expect(translated).toContain('lang="fi"')
  })
  it('renders allowlisted external links with safe new-tab attributes and escapes text', () => {
    const articles = structuredClone(helpCatalog('en'))
    articles['fortnox-connect'].body.push({
      type: 'paragraph',
      children: [{ type: 'text', value: '<script>literal</script>' }],
    })
    vi.mocked(useHelpContent).mockReturnValue({
      tenantId: 'synthetic',
      locale: 'en',
      articles,
    })
    const html = renderToStaticMarkup(
      createElement(HelpArticle, {
        topic: 'fortnox-connect',
        d: dictionary('en').helpCenter,
      }),
    )
    expect(html).toContain('target="_blank" rel="noreferrer"')
    expect(html).toContain('&lt;script&gt;literal&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})
