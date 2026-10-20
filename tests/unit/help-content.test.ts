import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { stringify } from 'yaml'
import {
  buildHelpContent,
  generatedHelpModule,
  parseHelpFile,
} from '../../scripts/build-help-content.mjs'
import { helpArticle } from '../../lib/help/content'
import { helpTopicForPage } from '../../lib/help/topics'
import { dictionary } from '../../lib/i18n'

const metadata = {
  title: 'Help',
  summary: 'Summary',
  routes: [{ path: '/members' }],
  taskLinks: [{ href: '/members', label: 'Members' }],
  lastReviewed: '2026-10-20',
}
const source = (body = 'Text', changes = {}) =>
  `---\n${stringify({ ...metadata, ...changes })}---\n${body}\n`
const parse = (body: string, changes = {}) =>
  parseHelpFile(source(body, changes), 'content/help/en/example.md', [
    '/members',
  ])

describe('restricted help content build', () => {
  it('has a current checked-in module', async () => {
    expect(await generatedHelpModule(await buildHelpContent())).toBe(
      (await readFile('lib/help/content.generated.ts', 'utf8')).replace(
        /\r\n/g,
        '\n',
      ),
    )
  })
  it.each([
    '<script>alert(1)</script>',
    '<div>HTML</div>',
    '![picture](/members)',
    '# Heading',
    '#### Heading',
    '```\ncode\n```',
    '---',
    'a | b\n--- | ---\nc | d',
    'Footnote[^1]\n\n[^1]: secret',
    '[link](javascript:alert)',
    '[link](http://example.test)',
    '[link](https://example.test)',
    '[link](//example.test)',
    '[link](/missing)',
    '[reference][x]\n\n[x]: /members',
  ])(
    'rejects unsupported or unsafe Markdown with file and line: %s',
    (body) => {
      expect(() => parse(body)).toThrow(/content\/help\/en\/example\.md:\d+:/)
    },
  )
  it.each([
    { extra: true },
    { title: '' },
    { title: 'x'.repeat(81) },
    { summary: 'x'.repeat(241) },
    { lastReviewed: '2026-02-30' },
    { video: 'https://example.test/video' },
    { routes: [{ path: '/missing' }] },
    { taskLinks: [{ href: '/missing', label: 'Missing' }] },
    { externalLinks: ['http://example.test'] },
  ])('rejects invalid metadata %j', (changes) => {
    expect(() => parse('Text', changes)).toThrow(/example\.md:\d+:/)
  })
  it('allows the documented subset and exact HTTPS allowlist', () => {
    const result = parse(
      '## Heading\n\n### Smaller\n\n*Italic* **bold** `code`\n\n- one\n- two\n\n1. ordered\n\n> Notice\n\n[Members](/members) [Provider](https://example.test/)',
      { externalLinks: ['https://example.test/'], machineTranslated: true },
    )
    expect(result.machineTranslated).toBe(true)
    expect(result.body.map((node) => node?.type)).toEqual([
      'heading',
      'heading',
      'paragraph',
      'list',
      'list',
      'blockquote',
      'paragraph',
    ])
  })
  it.each(['missing', 'routes', 'links', 'external', 'duplicate'])(
    'rejects cross-file problem: %s',
    async (problem) => {
      const root = await mkdtemp(join(tmpdir(), 'komisio-help-'))
      try {
        for (const dir of [
          'app/(dashboard)/members',
          'app/(dashboard)/account',
          'content/help/en',
          'content/help/sv',
        ])
          await mkdir(join(root, dir), { recursive: true })
        for (const page of ['members', 'account'])
          await writeFile(join(root, `app/(dashboard)/${page}/page.tsx`), '')
        await writeFile(join(root, 'content/help/en/example.md'), source())
        if (problem !== 'missing') {
          const changes =
            problem === 'routes'
              ? { routes: [{ path: '/account' }] }
              : problem === 'links'
                ? { taskLinks: [{ href: '/account', label: 'Account' }] }
                : problem === 'external'
                  ? { externalLinks: ['https://example.test/'] }
                  : {}
          await writeFile(
            join(root, 'content/help/sv/example.md'),
            source('Text', changes),
          )
        }
        if (problem === 'duplicate')
          for (const locale of ['sv', 'en'])
            await writeFile(
              join(root, `content/help/${locale}/duplicate.md`),
              source(),
            )
        await expect(buildHelpContent(root)).rejects.toThrow(
          problem === 'missing'
            ? /sv and en/
            : problem === 'duplicate'
              ? /duplicate route/
              : /cross-locale/,
        )
      } finally {
        if (
          !resolve(root).startsWith(resolve(tmpdir()) + sep + 'komisio-help-')
        )
          throw new Error('Unexpected temporary directory')
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it('uses English for missing help translations without changing the product fallback', () => {
    expect(helpArticle('fi', 'members-roles')).toMatchObject({
      fallback: true,
      sourceLocale: 'en',
    })
    expect(helpArticle('sv', 'members-roles')).toMatchObject({
      fallback: false,
      sourceLocale: 'sv',
    })
    expect(helpArticle('sv', 'constructor')).toBeNull()
    expect(dictionary('unknown')).toBe(dictionary('sv'))
  })
  it.each([
    ['/intake/sellers/new', 'sellers-agreements'],
    ['/intake/sellers/a', 'sellers-agreements'],
    ['/intake/payouts/payment-sheet', 'payouts-settlements'],
    ['/intake/statements/a', 'payouts-settlements'],
    ['/intake/sales/a', 'sales-day-close'],
    ['/intake/items/a', 'items-lifecycle'],
    ['/intake/lifecycle', 'items-lifecycle'],
    ['/members', 'members-roles'],
    ['/settings/seller-registration', 'seller-portal'],
    ['/intake/submissions', 'seller-portal'],
    ['/account', 'sign-in-mfa'],
  ])('maps new route %s', (path, topic) => {
    expect(helpTopicForPage(path, null, null)).toBe(topic)
  })
})
