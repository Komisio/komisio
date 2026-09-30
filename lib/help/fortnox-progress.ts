export type FortnoxProgressFacts = {
  connected: boolean | null
  mapped: boolean | null
  exported: boolean | null
  sent: boolean | null
}
export const fortnoxStepKeys = [
  'connected',
  'mapped',
  'exported',
  'sent',
] as const
export function fortnoxProgress(facts: FortnoxProgressFacts) {
  return fortnoxStepKeys.map(
    (key) =>
      ({
        key,
        state: facts[key] === null ? 'unknown' : facts[key] ? 'done' : 'needed',
      }) as const,
  )
}
