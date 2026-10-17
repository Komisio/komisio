const fallback = '/intake/items'
const base = 'https://komisio.invalid'

/** Only inventory and intake destinations; never turn a query parameter into an open redirect. */
export function itemReturnHref(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > 4096 ||
    !input.startsWith('/') ||
    input.startsWith('//') ||
    /[\\\u0000-\u001f]/.test(input)
  )
    return fallback
  try {
    const url = new URL(input, base)
    if (
      url.origin !== base ||
      !/^\/intake\/(items|bags\/[0-9a-f-]{36}\/inspect|reception\/[0-9a-f-]{36})$/.test(
        url.pathname,
      )
    )
      return fallback
    const hash = /^#inventory-item-[0-9a-f-]{36}$/.test(url.hash)
      ? url.hash
      : ''
    return url.pathname + url.search + hash
  } catch {
    return fallback
  }
}

export function isIntakeReturn(href: string) {
  return /^\/intake\/(bags|reception)\//.test(itemReturnHref(href))
}

export function itemFromListHref(itemId: string, listing: string, hash = '') {
  const destination = itemReturnHref(listing)
  const returnTo = destination.startsWith('/intake/reception/')
    ? destination
    : itemReturnHref(destination + '#inventory-item-' + itemId)
  return `/intake/items/${itemId}?${new URLSearchParams({ returnTo })}${hash}`
}
