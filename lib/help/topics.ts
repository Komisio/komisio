export const helpTopics = [
  'receiving',
  'labels',
  'fortnox-connect',
  'fortnox-first-export',
  'fortnox-automation',
  'fortnox-recovery',
] as const
export type HelpTopic = (typeof helpTopics)[number]
export function isHelpTopic(value: string): value is HelpTopic {
  return (helpTopics as readonly string[]).includes(value)
}

/** Match only supported task routes; integration detail pages own their help. */
export function helpTopicForPage(
  path: string,
  view: string | null,
  tab: string | null,
): HelpTopic | null {
  if (path === '/intake/accounting') {
    return view === 'settings'
      ? 'fortnox-connect'
      : view === 'reconciliation'
        ? 'fortnox-recovery'
        : 'fortnox-first-export'
  }
  if (path === '/intake/integrations') return 'fortnox-connect'
  if (
    (path === '/settings' && tab === 'printing') ||
    path === '/intake/open' ||
    /^\/intake\/bags\/[^/]+$/.test(path) ||
    /^\/intake\/(items|reception)\/[^/]+\/label$/.test(path)
  )
    return 'labels'
  if (
    [
      '/intake',
      '/intake/quick',
      '/intake/handovers',
      '/intake/flow',
      '/intake/reception',
    ].includes(path) ||
    /^\/intake\/bags\/[^/]+\/inspect$/.test(path) ||
    /^\/intake\/reception\/[^/]+$/.test(path)
  )
    return 'receiving'
  return null
}
