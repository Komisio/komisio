// The desktop sidebar width is a device preference. A cookie lets the server
// render the saved width, so a reload does not flash the expanded menu first.
// Mobile keeps the bottom bar; this preference only applies from 701px, the
// same breakpoint as the shell in app/globals.css.

export const SIDEBAR_COOKIE = 'komisio-sidebar'
export const SIDEBAR_ID = 'app-sidebar'
export const SIDEBAR_DESKTOP_QUERY = '(min-width: 701px)'

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export type SidebarShortcutEvent = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
}

export function readSidebarCollapsed(value: string | null | undefined) {
  return value === 'collapsed'
}

export function sidebarCookie(collapsed: boolean) {
  const value = collapsed ? 'collapsed' : 'expanded'
  return `${SIDEBAR_COOKIE}=${value};path=/;max-age=31536000;SameSite=Lax`
}

/** Flip the preference and persist it. The sidebar toggle and shortcut share this. */
export function commitSidebarToggle(
  collapsed: boolean,
  writeCookie: (value: string) => void,
) {
  const next = !collapsed
  writeCookie(sidebarCookie(next))
  return next
}

export function isSidebarShortcut(event: SidebarShortcutEvent) {
  if (event.repeat || event.altKey || event.shiftKey) return false
  if (!event.metaKey && !event.ctrlKey) return false
  return event.code === 'KeyB' || event.key.toLowerCase() === 'b'
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object' || !('closest' in target))
    return false
  const closest = (target as { closest?: unknown }).closest
  if (typeof closest !== 'function') return false
  return Boolean(
    (closest as (selector: string) => unknown).call(target, EDITABLE_SELECTOR),
  )
}
