import type { Dictionary } from '../i18n'
import { helpTopics } from './topics'

const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/** Local dictionary text only. This query is never put in a URL or sent to a server. */
export function searchHelp(d: Dictionary['helpCenter'], query: string) {
  const needle = normalize(query.trim())
  return helpTopics.filter((topic) => {
    const article = d.articles[topic]
    return normalize(
      [article.title, article.intro, ...article.steps, article.notice].join(
        ' ',
      ),
    ).includes(needle)
  })
}
