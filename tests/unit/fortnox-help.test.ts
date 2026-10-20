import { helpCatalog } from '../../lib/help/content'
import { describe, expect, it } from 'vitest'
import { fortnoxProgress } from '../../lib/help/fortnox-progress'
import { helpTopics, isHelpTopic } from '../../lib/help/topics'
import { locales } from '../../lib/i18n'

describe('Fortnox help evidence', () => {
  it('does not turn a connection into accounting readiness', () => {
    expect(
      fortnoxProgress({
        connected: true,
        mapped: false,
        exported: false,
        sent: false,
      }).map((s) => s.state),
    ).toEqual(['done', 'needed', 'needed', 'needed'])
  })
  it('keeps unavailable reads distinct from absent work and recorded completion', () => {
    expect(
      fortnoxProgress({
        connected: true,
        mapped: null,
        exported: null,
        sent: null,
      }).map((s) => s.state),
    ).toEqual(['done', 'unknown', 'unknown', 'unknown'])
    expect(
      fortnoxProgress({
        connected: true,
        mapped: true,
        exported: true,
        sent: false,
      }).at(-1)?.state,
    ).toBe('needed')
  })
  it('provides complete, nonempty task instructions in all product languages', () => {
    for (const locale of locales) {
      for (const topic of helpTopics) {
        const article = helpCatalog(locale)[topic]
        expect(article.title.trim(), `${locale}/${topic}`).not.toBe('')
        expect(article.body.length).toBeGreaterThan(0)
        expect(article.text.trim()).not.toBe('')
      }
    }
    expect(isHelpTopic('constructor')).toBe(false)
    expect(isHelpTopic('unknown-topic')).toBe(false)
  })
})
