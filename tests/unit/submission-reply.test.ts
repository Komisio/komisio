import { expect, it } from 'vitest'
import { renderSubmissionReply } from '../../lib/communications/submission-reply'
import { locales } from '../../lib/i18n'
it('links every localized reply to the authenticated seller portal without asserting receipt', () => {
  for (const locale of locales) {
    const result = renderSubmissionReply(
      locale,
      'Store',
      'seller-id',
      'https://example.test',
    )
    const link = new URL(result.body.match(/https:\/\/\S+/)![0])
    expect(link.pathname).toBe('/seller/submissions')
    expect(link.searchParams.get('seller')).toBe('seller-id')
    expect(result.body).not.toMatch(/\{(url|store)\}/)
  }
})
it('does not interpolate placeholders in store names or permit unsafe link schemes', () => {
  expect(
    renderSubmissionReply('en', '{url}', 'seller-id', 'https://example.test')
      .body,
  ).toContain('{url}')
  expect(() =>
    renderSubmissionReply('en', 'Store', 'seller-id', 'javascript:alert(1)'),
  ).toThrow()
})
