import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../components/platform/sidebar'
import { dictionary, locales } from '../../lib/i18n'
import { buildNavigation } from '../../lib/platform/navigation'
import {
  SIDEBAR_DESKTOP_QUERY,
  SIDEBAR_ID,
  commitSidebarToggle,
  isEditableShortcutTarget,
  isSidebarShortcut,
  readSidebarCollapsed,
  sidebarCookie,
} from '../../lib/platform/sidebar-preference'
import type { Tenant } from '../../lib/platform/types'

vi.mock('next/navigation', () => ({
  usePathname: () => '/intake/items',
}))

const store: Tenant = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Synthetic store',
  slug: 'synthetic',
  role: 'owner',
}

function renderSidebar(collapsed: boolean) {
  const d = dictionary('en')
  return renderToStaticMarkup(
    createElement(Sidebar, {
      d,
      tenants: [store],
      active: store,
      email: 'owner@example.test',
      name: 'Ada Owner',
      intakeEnabled: true,
      host: false,
      collapsed,
      ready: true,
      busy: false,
      signingOut: false,
      onSelect: () => {},
      onSignOut: () => {},
    }),
  )
}

describe('sidebar preference', () => {
  it('remembers only an explicit collapsed value and writes a durable cookie', () => {
    expect(readSidebarCollapsed(undefined)).toBe(false)
    expect(readSidebarCollapsed(null)).toBe(false)
    expect(readSidebarCollapsed('expanded')).toBe(false)
    expect(readSidebarCollapsed('true')).toBe(false)
    expect(readSidebarCollapsed('collapsed')).toBe(true)
    const writes: string[] = []
    expect(commitSidebarToggle(false, (value) => writes.push(value))).toBe(true)
    expect(commitSidebarToggle(true, (value) => writes.push(value))).toBe(false)
    expect(writes.map((value) => value.split(';')[0])).toEqual([
      'komisio-sidebar=collapsed',
      'komisio-sidebar=expanded',
    ])
    for (const value of writes) {
      expect(value).toContain('path=/')
      expect(value).toContain('SameSite=Lax')
      expect(value).toContain('max-age=31536000')
    }
    expect(
      readSidebarCollapsed(sidebarCookie(true).split(';')[0]?.split('=')[1]),
    ).toBe(true)
    expect(
      readSidebarCollapsed(sidebarCookie(false).split(';')[0]?.split('=')[1]),
    ).toBe(false)
  })

  it('accepts Ctrl or Cmd+B and ignores typing, chords and editable fields', () => {
    const base = {
      key: 'b',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    }
    expect(isSidebarShortcut(base)).toBe(true)
    expect(isSidebarShortcut({ ...base, ctrlKey: false, metaKey: true })).toBe(
      true,
    )
    expect(isSidebarShortcut({ ...base, code: 'KeyB', key: '∫' })).toBe(true)
    expect(isSidebarShortcut({ ...base, ctrlKey: false })).toBe(false)
    expect(isSidebarShortcut({ ...base, shiftKey: true })).toBe(false)
    expect(isSidebarShortcut({ ...base, altKey: true })).toBe(false)
    expect(isSidebarShortcut({ ...base, repeat: true })).toBe(false)
    expect(isSidebarShortcut({ ...base, key: 'a', code: 'KeyA' })).toBe(false)
    expect(SIDEBAR_DESKTOP_QUERY).toBe('(min-width: 701px)')
    const field = {
      closest: () => ({ tag: 'input' }),
    } as unknown as EventTarget
    const plain = { closest: () => null } as unknown as EventTarget
    expect(isEditableShortcutTarget(field)).toBe(true)
    expect(isEditableShortcutTarget(plain)).toBe(false)
    expect(isEditableShortcutTarget(null)).toBe(false)
  })

  it('names the toggle in every product language', () => {
    for (const locale of locales) {
      const nav = dictionary(locale).nav
      expect(nav.collapseMenu.trim().length).toBeGreaterThan(0)
      expect(nav.expandMenu.trim().length).toBeGreaterThan(0)
      expect(nav.menuShortcut.trim().length).toBeGreaterThan(0)
      expect(nav.collapseMenu).not.toBe(nav.expandMenu)
    }
  })
})

describe('sidebar rendering', () => {
  const labels = buildNavigation(dictionary('en'), {
    intakeEnabled: true,
    host: false,
  }).flatMap((group) => group.links.map((link) => link.label))

  it('starts expanded with a labelled toggle, the active item and the store select', () => {
    const html = renderSidebar(false)
    expect(html).toContain(`id="${SIDEBAR_ID}"`)
    expect(html).not.toContain('sidebar-collapsed')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(`aria-controls="${SIDEBAR_ID}"`)
    expect(html).toContain('aria-keyshortcuts="Control+b Meta+b"')
    expect(html).toContain('Collapse menu')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('nav-link active')
    expect(html).toContain('<select')
    expect(html).not.toContain('sidebar-flyout')
    expect(html).toContain('Synthetic store')
    expect(html).toContain('Add a store')
    for (const label of labels) expect(html).toContain(label)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('collapses to icons while keeping every label and the active item', () => {
    const html = renderSidebar(true)
    expect(html).toContain('sidebar sidebar-collapsed')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Expand menu')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('nav-link active')
    expect(html).toContain('aria-haspopup="true"')
    expect(html).toContain('popover="manual"')
    expect(html).toContain('sidebar-flyout')
    expect(html).toContain('Active store: Synthetic store')
    expect(html).toContain('<select')
    expect(html).toContain('Add a store')
    for (const label of labels) expect(html).toContain(label)
    for (const group of [
      'Receiving',
      'Goods',
      'Sellers',
      'Money',
      'Work',
      'Store',
    ])
      expect(html).toContain(group)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
})

describe('sidebar layout contract', () => {
  const css = readFileSync(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  )

  it('grows the shell with the rail, skips motion when asked, and hides on narrow screens', () => {
    expect(css).toContain('--sidebar-width: 242px')
    expect(css).toContain('--sidebar-width: 72px')
    expect(css).toContain('transition: --sidebar-width 160ms ease')
    expect(css).toContain('padding-left: var(--sidebar-width)')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.app-shell,\s*\.sidebar \{\s*transition: none;/,
    )
    expect(css).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*\.sidebar \{\s*display: none;/,
    )
  })
})
