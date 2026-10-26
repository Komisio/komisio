const base = 'https://komisio.invalid'
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const details = new RegExp(
  `^/intake/(?:(?:items|sales|purchases|operations|statements|integrations)/${uuid}|sellers/${uuid}(?:/privacy)?|reception/${uuid}(?:/history)?|bags/${uuid}(?:/inspect)?)$`,
)
const lists =
  /^\/intake(?:\/(?:items|stock|sellers|sales|payouts|submissions|operations|lifecycle|purchases|pricing|stocktake|reception|handovers|agreements|quick|economy|import|integrations))?$/
const secondary =
  /^\/intake\/(?:sellers\/registrations|payouts\/payment-sheet|items\/(?:classify|import)|import\/(?:items|pos))$/
const fragments =
  /^#(?:inventory-item-[0-9a-f-]{36}|(?:seller|sales|purchases|payouts|stock|bag|intake|item|reception|stocktake|operations|paypal|shopify|integration)-[a-z0-9-]{1,80}|new-seller)$/

/** A return target is a known staff view, not an arbitrary same-origin URL. */
export function staffReturnHref(
  input: unknown,
  fallback = '/intake/items',
): string {
  if (
    typeof input !== 'string' ||
    input.length > 4096 ||
    !input.startsWith('/') ||
    input.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/.test(input)
  )
    return fallback
  try {
    const url = new URL(input, base)
    // Reject normalization tricks and encoded route separators as well as external URLs.
    const path = input.split(/[?#]/, 1)[0]
    if (
      url.origin !== base ||
      path !== url.pathname ||
      path.includes('%') ||
      !(lists.test(path) || details.test(path) || secondary.test(path))
    )
      return fallback
    return (
      url.pathname + url.search + (fragments.test(url.hash) ? url.hash : '')
    )
  } catch {
    return fallback
  }
}

export function isStaffDetailHref(input: unknown): input is string {
  return typeof input === 'string' && details.test(input.split(/[?#]/, 1)[0])
}

/** Paging inside a detail must not overwrite the originating list's position. */
export function sameStaffView(left: string, right: string) {
  const a = staffReturnHref(left, '')
  const b = staffReturnHref(right, '')
  if (!a || !b) return false
  const x = new URL(a, base),
    y = new URL(b, base)
  return (
    x.pathname === y.pathname &&
    x.searchParams.toString() === y.searchParams.toString()
  )
}

export function detailFromOrigin(href: string, origin: string): string {
  const source = staffReturnHref(origin, '')
  if (!source || !isStaffDetailHref(href)) return href
  const target = new URL(href, base)
  // Explicit intake/inventory origins also carry row anchors; retain those contracts.
  if (target.searchParams.has('returnTo')) return href
  const from = new URL(source, base)
  if (target.pathname === from.pathname) {
    const original = staffReturnHref(from.searchParams.get('returnTo'), '')
    if (!original) return href
    target.searchParams.set('returnTo', original)
  } else target.searchParams.set('returnTo', source)
  const result = target.pathname + target.search + target.hash
  return result.length <= 8192 ? result : href
}
