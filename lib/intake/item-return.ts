import { staffReturnHref } from '@/lib/platform/return-navigation'

/** Staff origins are validated centrally, including legacy inventory row anchors. */
export function itemReturnHref(input: unknown): string {
  return staffReturnHref(input)
}

export function isIntakeReturn(href: string) {
  return /^\/intake\/(bags|reception)\//.test(itemReturnHref(href))
}

export function itemFromListHref(itemId: string, listing: string, hash = '') {
  const destination = itemReturnHref(listing)
  const returnTo = destination.startsWith('/intake/reception/')
    ? destination
    : itemReturnHref(destination.split('#')[0] + '#inventory-item-' + itemId)
  return `/intake/items/${itemId}?${new URLSearchParams({ returnTo })}${hash}`
}
