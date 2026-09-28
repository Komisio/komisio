import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import ErrorPage from '../../app/error'
import { LocaleProvider } from '../../components/platform/locale-provider'
import { dictionary, locales } from '../../lib/i18n'

it.each(locales)(
  'renders error recovery in the document language: %s',
  (locale) => {
    const d = dictionary(locale)
    const markup = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { locale },
        createElement(ErrorPage, { retry: () => {} }),
      ),
    )
    // The first server render must use the selected language without browser globals.
    expect(markup).toContain(
      renderToStaticMarkup(createElement('h1', null, d.unexpected)),
    )
    expect(markup).toContain(`>${d.retry}</button>`)
    expect(markup).toContain('<main ')
  },
)
