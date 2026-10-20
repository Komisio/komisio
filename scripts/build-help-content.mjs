import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { z } from 'zod'
import { format } from 'prettier'

export const helpLocales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const selector = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/)
const internal = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => {
    if (
      !value.startsWith('/') ||
      value.startsWith('//') ||
      /[\\\u0000-\u0020\u007f]/.test(value)
    )
      return false
    return (
      new URL(value, 'https://help.invalid').origin === 'https://help.invalid'
    )
  }, 'Expected a single-slash internal path')
const external = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, 'Expected an HTTPS URL without credentials')
export const frontMatter = z.strictObject({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(240),
  routes: z
    .array(
      z.strictObject({
        path: internal.refine((value) => !/[?#]/.test(value)),
        view: selector.optional(),
        tab: selector.optional(),
      }),
    )
    .max(100),
  taskLinks: z
    .array(
      z.strictObject({ href: internal, label: z.string().min(1).max(120) }),
    )
    .max(30),
  externalLinks: z.array(external).max(30).default([]),
  video: z.null().optional(),
  lastReviewed: z.iso.date(),
  machineTranslated: z.boolean().default(false),
})

function routeMatches(template, path) {
  const a = template.split('/'),
    b = path.split('/')
  return (
    a.length === b.length &&
    a.every((part, i) =>
      /^\[[a-zA-Z0-9_]+\]$/.test(part) ? !!b[i] : part === b[i],
    )
  )
}
export async function dashboardRoutes(root) {
  const base = resolve(root, 'app/(dashboard)')
  const routes = []
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.name === 'page.tsx') {
        const parts = relative(base, dir)
          .split(sep)
          .filter((part) => part && !part.startsWith('('))
        routes.push('/' + parts.join('/'))
      }
    }
  }
  await visit(base)
  return routes.sort()
}
export function parseHelpFile(source, file, pages) {
  const normalized = source.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized)
  const fail = (message, line = 1) => {
    throw new Error(`${file}:${line}: ${message}`)
  }
  if (!match) fail('Missing YAML front matter')
  const document = parseDocument(match[1], { uniqueKeys: true, strict: true })
  if (document.errors.length || document.warnings.length)
    fail((document.errors[0] ?? document.warnings[0]).message, 2)
  let metadata
  try {
    metadata = frontMatter.parse(document.toJS({ maxAliasCount: 0 }))
  } catch (error) {
    fail(`Invalid front matter: ${error.message}`, 2)
  }
  for (const route of metadata.routes)
    if (!pages.includes(route.path))
      fail(`Route has no dashboard page: ${route.path}`)
  const checkInternal = (href, line = 1) => {
    if (!internal.safeParse(href).success)
      fail(`Invalid internal link: ${href}`, line)
    const path = new URL(href, 'https://help.invalid').pathname
    if (!pages.some((route) => routeMatches(route, path)))
      fail(`Link has no dashboard page: ${href}`, line)
  }
  for (const link of metadata.taskLinks) checkInternal(link.href)
  const offset = match[0].split('\n').length - 1
  const markdown = normalized.slice(match[0].length)
  // CommonMark treats GFM tables as plain paragraphs. Reject their delimiter
  // syntax explicitly rather than silently displaying unsupported tables.
  for (const [index, line] of markdown.split('\n').entries())
    if (/^\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)+\s*$/.test(line))
      fail('Unsupported Markdown table', index + 1 + offset)
  const tree = unified().use(remarkParse).parse(markdown)
  function convert(node) {
    const line = (node.position?.start.line ?? 1) + offset
    const children = () => (node.children ?? []).map(convert)
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        return { type: node.type, value: node.value }
      case 'paragraph':
      case 'emphasis':
      case 'strong':
      case 'blockquote':
      case 'listItem':
        return { type: node.type, children: children() }
      case 'heading':
        if (![2, 3].includes(node.depth))
          fail('Only level 2 and 3 headings are allowed', line)
        return { type: 'heading', depth: node.depth, children: children() }
      case 'list':
        return {
          type: 'list',
          ordered: !!node.ordered,
          start: node.start ?? 1,
          children: children(),
        }
      case 'link':
        if (node.url.startsWith('/')) checkInternal(node.url, line)
        else if (
          !external.safeParse(node.url).success ||
          !metadata.externalLinks.includes(node.url)
        )
          fail(`External link is not in the HTTPS allowlist: ${node.url}`, line)
        return { type: 'link', url: node.url, children: children() }
      default:
        fail(`Unsupported Markdown node: ${node.type}`, line)
    }
  }
  const body = tree.children.map(convert)
  const textOf = (node) =>
    'value' in node ? node.value : node.children.map(textOf).join(' ')
  const { video: _video, ...fields } = metadata
  void _video
  return { ...fields, body, text: body.map(textOf).join('\n') }
}

export async function buildHelpContent(root = process.cwd()) {
  const pages = await dashboardRoutes(root)
  const base = resolve(root, 'content/help')
  const content = {}
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !helpLocales.includes(entry.name))
      throw new Error(
        `content/help/${entry.name}: unsupported locale directory`,
      )
    const locale = entry.name
    for (const file of (await readdir(resolve(base, locale))).sort()) {
      const topic = file.replace(/\.md$/, '')
      if (!file.endsWith('.md') || !slug.test(topic) || topic.length > 80)
        throw new Error(
          `content/help/${locale}/${file}: invalid article filename`,
        )
      content[topic] ??= {}
      const path = `content/help/${locale}/${file}`
      content[topic][locale] = parseHelpFile(
        await readFile(resolve(root, path), 'utf8'),
        path,
        pages,
      )
    }
  }
  const claims = new Map()
  for (const [topic, translations] of Object.entries(content)) {
    if (!translations.en || !translations.sv)
      throw new Error(`${topic}: sv and en articles are required`)
    const canonical = (article) =>
      JSON.stringify({
        routes: article.routes,
        hrefs: article.taskLinks.map((link) => link.href),
        externalLinks: article.externalLinks,
      })
    for (const [locale, article] of Object.entries(translations))
      if (canonical(article) !== canonical(translations.en))
        throw new Error(
          `content/help/${locale}/${topic}.md: cross-locale routes or links differ from English`,
        )
    for (const route of translations.en.routes) {
      const key = JSON.stringify([
        route.path,
        route.view ?? null,
        route.tab ?? null,
      ])
      if (claims.has(key))
        throw new Error(
          `${topic}: duplicate route claim ${key} (${claims.get(key)})`,
        )
      claims.set(key, topic)
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(content)
      .sort()
      .map((topic) => [
        topic,
        Object.fromEntries(
          helpLocales
            .filter((locale) => content[topic][locale])
            .map((locale) => [locale, content[topic][locale]]),
        ),
      ]),
  )
  return sorted
}
export async function generatedHelpModule(content) {
  const topics = Object.keys(content)
  const routes = topics.flatMap((topic) =>
    content[topic].en.routes.map((route) => ({ topic, ...route })),
  )
  return format(
    `// Generated by npm run help:build. Do not edit by hand.\nimport type { HelpContent, HelpRoute } from './content-types'\nexport const helpTopics = ${JSON.stringify(topics)} as const\nexport const helpRouteClaims: (HelpRoute & {topic: typeof helpTopics[number]})[] = ${JSON.stringify(routes)}\nexport const helpContent: Record<string, Partial<Record<string, HelpContent>>> = ${JSON.stringify(content)}\n`,
    {
      parser: 'typescript',
      singleQuote: true,
      semi: false,
      trailingComma: 'all',
    },
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const generated = await generatedHelpModule(await buildHelpContent())
  const target = resolve('lib/help/content.generated.ts')
  if (process.argv.includes('--check')) {
    if ((await readFile(target, 'utf8')).replace(/\r\n/g, '\n') !== generated)
      throw new Error('Stale help content: run npm run help:build')
  } else await writeFile(target, generated)
  console.log('Validated and generated help content')
}
