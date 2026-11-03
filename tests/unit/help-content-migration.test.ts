import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { buildHelpContent } from '../../scripts/build-help-content.mjs'
import legacy from '../fixtures/help-legacy.json'

describe('reviewed legacy help migration', () => {
  it('preserves legacy guidance in all eight languages with reviewed receiving method labels', async () => {
    const content = await buildHelpContent()
    const text = (node: { value?: string; children?: unknown[] }): string =>
      node.value ??
      (node.children as Parameters<typeof text>[0][]).map(text).join('')
    for (const [locale, original] of Object.entries(legacy)) {
      // Before removal, also compare the snapshot with the actual legacy JSON.
      const dictionary = JSON.parse(
        await readFile(`messages/${locale}.json`, 'utf8'),
      )
      if (dictionary.helpCenter.articles)
        expect(original.articles).toEqual(dictionary.helpCenter.articles)
      for (const [topic, previous] of Object.entries(original.articles)) {
        const migrated = content[topic][locale]
        expect(migrated.title).toBe(previous.title)
        expect(migrated.summary).toBe(previous.intro)
        expect(text(migrated.body[0])).toBe(previous.intro)
        const steps = migrated.body.find(
          (node: { type: string; ordered?: boolean }) =>
            node.type === 'list' && node.ordered,
        )
        expect(steps?.children.map(text)).toEqual(previous.steps)
        const notice = migrated.body.find(
          (node: { type: string }) => node.type === 'blockquote',
        )
        expect(notice).toBeDefined()
        expect(text(notice)).toBe(previous.notice)
        const previousLinks =
          original.taskLinks[topic as keyof typeof original.taskLinks]
        // #753 clarifies both receiving methods without removing legacy tasks.
        expect(migrated.taskLinks).toEqual(
          topic === 'receiving'
            ? [
                { href: '/intake', label: dictionary.nav.receiveBag },
                { href: '/intake/quick', label: dictionary.quickIntake.title },
                ...previousLinks.slice(1),
              ]
            : previousLinks,
        )
        expect(migrated.machineTranslated).toBe(false)
        if (topic === 'fortnox-connect')
          expect(text(migrated.body[3])).toBe(original.providerHelp)
      }
    }
  })
})
