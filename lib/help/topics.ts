import { helpTopics, helpRouteClaims } from './content.generated'
export { helpTopics }
export type HelpTopic = (typeof helpTopics)[number]
export function isHelpTopic(value: string): value is HelpTopic {
  return (helpTopics as readonly string[]).includes(value)
}

/** Query-specific claims win; dynamic segments match exactly one nonempty part. */
export function helpTopicForPage(
  path: string,
  view: string | null,
  tab: string | null,
): HelpTopic | null {
  const parts = path.split('/')
  const matches = helpRouteClaims.filter((route) => {
    const template = route.path.split('/')
    return (
      template.length === parts.length &&
      template.every((part, index) =>
        /^\[[a-zA-Z0-9_]+\]$/.test(part)
          ? !!parts[index]
          : part === parts[index],
      ) &&
      (route.view === undefined || route.view === view) &&
      (route.tab === undefined || route.tab === tab)
    )
  })
  const score = (route: (typeof helpRouteClaims)[number]) =>
    (route.view !== undefined ? 2 : 0) + (route.tab !== undefined ? 1 : 0)
  matches.sort(
    (a, b) =>
      score(b) - score(a) ||
      Number(a.path.includes('[')) - Number(b.path.includes('[')),
  )
  return matches[0]?.topic ?? null
}
