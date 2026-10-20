import type { HelpCatalog } from './content'

const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/** Selected locale only. The query is never put in a URL or sent to a server. */
export function searchHelp(articles: HelpCatalog, query: string) {
  const needle = normalize(query.trim())
  return Object.keys(articles).filter((topic) => {
    const article = articles[topic]
    return normalize(
      [article.title, article.summary, article.text].join(' '),
    ).includes(needle)
  })
}
