import { staffReturnHref } from './return-navigation'

// Ephemeral tab memory: no query, seller identifier or form content is persisted.
const positions = new Map<string, { y: number; at: number }>()
let pending: { href: string; y: number; at: number } | null = null
const lifetime = 30 * 60 * 1000
export function rememberReturnPosition(
  href: string,
  y: number,
  now = Date.now(),
) {
  const safe = staffReturnHref(href, '')
  if (!safe || !Number.isFinite(y) || y < 0) return
  positions.delete(safe)
  positions.set(safe, { y, at: now })
  while (positions.size > 50) positions.delete(positions.keys().next().value!)
}
export function requestReturnPosition(href: string, now = Date.now()) {
  const safe = staffReturnHref(href, '')
  const saved = positions.get(safe)
  pending =
    saved && now - saved.at < lifetime
      ? { href: safe, y: saved.y, at: now }
      : null
}
export function takeReturnPosition(href: string, now = Date.now()) {
  if (!pending) return null
  if (now - pending.at > 15000) {
    pending = null
    return null
  }
  if (pending.href !== staffReturnHref(href, '')) return null
  const y = pending.y
  pending = null
  return y
}
export function clearReturnPositions() {
  positions.clear()
  pending = null
}
