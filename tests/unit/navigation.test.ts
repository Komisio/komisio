import { describe, expect, it } from 'vitest'
import { dictionary } from '../../lib/i18n'
import {
  buildNavigation,
  currentLink,
  isActivePath,
  mobileNavigation,
} from '../../lib/platform/navigation'

describe('navigation', () => {
  it('lists every store page once, with the host page only for hosts', () => {
    const d = dictionary('sv')
    const groups = buildNavigation(d, { intakeEnabled: true, host: false })
    const paths = groups.flatMap((g) => g.links.map((l) => l.path))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('/intake/accounting')
    expect(paths).not.toContain('/host')
    const hostPaths = buildNavigation(d, { intakeEnabled: true, host: true })
      .flatMap((g) => g.links)
      .map((l) => l.path)
    expect(hostPaths).toContain('/host')
    const minimal = buildNavigation(d, { intakeEnabled: false, host: false })
    expect(minimal.flatMap((g) => g.links).map((l) => l.path)).toEqual([
      '/',
      '/settings',
      '/members',
    ])
  })
  it('keeps the mobile bar at five entries and ends with more', () => {
    const mobile = mobileNavigation(dictionary('en'), true)
    expect(mobile).toHaveLength(5)
    expect(mobile.at(-1)?.path).toBe('/menu')
  })
  it('resolves the active link by the longest matching path', () => {
    const groups = buildNavigation(dictionary('sv'), {
      intakeEnabled: true,
      host: false,
    })
    expect(currentLink(groups, '/intake/bags/abc/inspect')?.path).toBe(
      '/intake',
    )
    expect(currentLink(groups, '/intake/accounting')?.path).toBe(
      '/intake/accounting',
    )
    expect(isActivePath('/', '/')).toBe(true)
    expect(isActivePath('/intake/items/1', '/intake')).toBe(false)
    expect(isActivePath('/intake/items/1', '/intake/items')).toBe(true)
    expect(currentLink(groups, '/intake/reception/abc')?.path).toBe(
      '/intake/operations',
    )
    expect(isActivePath('/intake/reception-extra', '/intake/operations')).toBe(
      false,
    )
  })
})
