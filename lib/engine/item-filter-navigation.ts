/** Filter links preserve the remaining criteria and sort, but start at page one. */
export function itemFilterHref(
  current: Record<string, string>,
  changes: Record<string, string | null>,
) {
  const params = new URLSearchParams(current)
  params.delete('page')
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  return '/intake/items' + (query ? '?' + query : '')
}

/** Calendar-day cutoff matching the existing Stockholm endsBefore read filter. */
export function itemWeekCutoff(now = new Date()) {
  const day = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + 7)
  return date.toISOString().slice(0, 10)
}
