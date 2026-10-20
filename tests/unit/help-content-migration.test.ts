import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { buildHelpContent } from '../../scripts/build-help-content.mjs'
import legacy from '../fixtures/help-legacy.json'

describe('reviewed legacy help migration', () => {
  it('preserves every original title, introduction, step, notice and task-link label in all eight languages', async () => {
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
        expect(migrated.body[1].type).toBe('list')
        expect(migrated.body[1].children.map(text)).toEqual(previous.steps)
        expect(migrated.body[2].type).toBe('blockquote')
        expect(text(migrated.body[2])).toBe(previous.notice)
        expect(migrated.taskLinks).toEqual(
          original.taskLinks[topic as keyof typeof original.taskLinks],
        )
        expect(migrated.machineTranslated).toBe(false)
        if (topic === 'fortnox-connect')
          expect(text(migrated.body[3])).toBe(original.providerHelp)
      }
    }
  })
})
