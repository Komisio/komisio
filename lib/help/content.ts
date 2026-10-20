import { helpContent, helpTopics } from './content.generated'
import type { HelpContent } from './content-types'

export type LocalizedHelp = HelpContent & {
  sourceLocale: string
  fallback: boolean
}
export type HelpCatalog = Record<string, LocalizedHelp>
/** Help alone falls back to English; the product dictionary policy is unchanged. */
export function helpArticle(
  locale: string,
  topic: string,
): LocalizedHelp | null {
  if (!Object.hasOwn(helpContent, topic)) return null
  const translations = helpContent[topic]
  const article = translations?.[locale] ?? translations?.en
  if (!article) return null
  return {
    ...article,
    sourceLocale: translations[locale] ? locale : 'en',
    fallback: !translations[locale],
  }
}
export function helpCatalog(locale: string): HelpCatalog {
  return Object.fromEntries(
    helpTopics.map((topic) => [topic, helpArticle(locale, topic)!]),
  )
}
