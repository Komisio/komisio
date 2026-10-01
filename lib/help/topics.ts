export const helpTopics = [
  'fortnox-connect',
  'fortnox-first-export',
  'fortnox-automation',
  'fortnox-recovery',
] as const
export type HelpTopic = (typeof helpTopics)[number]
export function isHelpTopic(value: string): value is HelpTopic {
  return (helpTopics as readonly string[]).includes(value)
}
