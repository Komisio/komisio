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
