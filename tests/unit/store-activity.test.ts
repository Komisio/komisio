import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { dictionary, locales } from '../../lib/i18n'
import { activityQuery } from '../../lib/engine/store-activity'
import { buildNavigation, isActivePath } from '../../lib/platform/navigation'
import { can, roles } from '../../lib/platform/permissions'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(new URL(f, dir), 'utf8').replaceAll("''", "'"))
const codes = new Set<string>()

it('every emitted audit action has a label, including dynamic status and chain actions', () => {
  for (const sql of files)
    for (const m of sql.matchAll(
      /\brecord_access\s*\(\s*[^,]+,\s*([^,;]+)/gi,
    )) {
      const expr = m[1].trim()
      if (expr.startsWith('p_action text')) continue
      if (/^'[a-z_]+\.[a-z_.]+'$/.test(expr)) {
        codes.add(expr.slice(1, -1))
        continue
      }
      if (expr.includes('case when')) {
        const literals = [...expr.matchAll(/'([^']+)'/g)].map((v) => v[1])
        if (expr.includes('||')) {
          for (const tail of literals.slice(1)) codes.add(literals[0] + tail)
        } else for (const code of literals) codes.add(code)
        continue
      }
      if (expr === 'p_action') {
        expect(sql).toContain('function komisio_private.set_chain(')
        for (const source of files)
          for (const call of source.matchAll(
            /perform\s+komisio_private\.set_chain\([^,]+,[^,]+,\s*'([^']+)'/gi,
          ))
            codes.add(call[1])
        continue
      }
      const dynamic = /^'([^']+)'\s*\|\|\s*(p_kind|p_status)$/.exec(expr)
      expect(dynamic, `Uncovered audit expression: ${expr}`).not.toBeNull()
      if (!dynamic) continue
      const before = sql.slice(0, m.index)
      const body = before.slice(before.toLowerCase().lastIndexOf('create '))
      const values = [
        ...body.matchAll(
          new RegExp(`${dynamic[2]}\\s+not\\s+in\\s*\\(([^)]+)\\)`, 'gi'),
        ),
      ].flatMap((list) => [...list[1].matchAll(/'([^']+)'/g)].map((v) => v[1]))
      if (!values.length && dynamic[2] === 'p_kind') {
        const block = body.slice(body.lastIndexOf('case p_kind'))
        for (const value of block.matchAll(/when '([^']+)' then/g))
          values.push(value[1])
      }
      expect(values.length, `Missing dynamic domain: ${expr}`).toBeGreaterThan(
        0,
      )
      for (const value of values) codes.add(dynamic[1] + value)
    }
  expect(codes.size).toBeGreaterThan(170)
  for (const locale of locales) {
    const d = dictionary(locale)
    for (const code of codes) {
      const label = (d.events as Record<string, string>)[code]
      expect(label, `${locale}: ${code}`).toBeTruthy()
      expect(label).not.toBe(code)
    }
    expect(Object.keys(d).some((k) => k.startsWith('audit.reception.'))).toBe(
      false,
    )
  }
})

it('rejects malformed filters and only lists audit navigation for authorized roles', () => {
  for (const query of [
    { actor: 'someone' },
    { from: '2026-02-30' },
    { from: '2026-10-24', to: '2026-10-23' },
    { page: 0 },
    { page: 40002 },
    { kind: 'x'.repeat(121) },
  ])
    expect(activityQuery.safeParse(query).success).toBe(false)
  expect(activityQuery.parse({})).toEqual({
    from: '',
    to: '',
    actor: '',
    kind: '',
    page: 1,
  })
  for (const role of roles) {
    const links = buildNavigation(dictionary('sv'), {
      intakeEnabled: true,
      host: false,
      audit: can(role, 'audit.read'),
    }).flatMap((g) => g.links)
    expect(links.some((l) => l.path === '/settings/activity')).toBe(
      ['owner', 'admin'].includes(role),
    )
  }
  expect(isActivePath('/settings/activity', '/settings')).toBe(false)
  expect(isActivePath('/settings/activity', '/settings/activity')).toBe(true)
})
