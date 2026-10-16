import type { ConnectorScope } from '../engine/connectors'

export const permissionAreas = [
  'reception',
  'items',
  'economy',
  'sales',
  'ledger',
  'lifecycle',
  'communications',
  'payouts',
  'accounting',
  'store',
  'other',
] as const
export const permissionLevels = ['read', 'preview', 'propose', 'other'] as const
type Area = (typeof permissionAreas)[number]
type Level = (typeof permissionLevels)[number]

// Presentation only: this does not authorize calls or imply permissions that
// were not granted. Unrecognized scopes remain visible in a separate group.
const presentation: Record<ConnectorScope, { area: Area; level: Level }> = {
  'reception:read': { area: 'reception', level: 'read' },
  'reception:preview': { area: 'reception', level: 'preview' },
  'reception:propose': { area: 'reception', level: 'propose' },
  'items:read': { area: 'items', level: 'read' },
  'items:propose': { area: 'items', level: 'propose' },
  'economy:read': { area: 'economy', level: 'read' },
  'sales:read': { area: 'sales', level: 'read' },
  'sales:propose': { area: 'sales', level: 'propose' },
  'ledger:propose': { area: 'ledger', level: 'propose' },
  'lifecycle:propose': { area: 'lifecycle', level: 'propose' },
  'communications:propose': { area: 'communications', level: 'propose' },
  'payouts:propose': { area: 'payouts', level: 'propose' },
  'accounting:read': { area: 'accounting', level: 'read' },
  'accounting:propose': { area: 'accounting', level: 'propose' },
  'store:read': { area: 'store', level: 'read' },
  'store:propose': { area: 'store', level: 'propose' },
}

export function summarizeConnectorPermissions(scopes: string[]) {
  const counts: Record<Level, number> = {
    read: 0,
    preview: 0,
    propose: 0,
    other: 0,
  }
  const grouped = new Map<Area, string[]>()
  for (const scope of new Set(scopes)) {
    const { area, level } = Object.hasOwn(presentation, scope)
      ? presentation[scope as ConnectorScope]
      : { area: 'other' as const, level: 'other' as const }
    counts[level]++
    grouped.set(area, [...(grouped.get(area) ?? []), scope])
  }
  return {
    counts,
    groups: permissionAreas.flatMap((area) => {
      const values = grouped.get(area)
      return values ? [{ area, scopes: values }] : []
    }),
  }
}
