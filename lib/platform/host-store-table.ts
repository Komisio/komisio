import type { ActivityRow, PlanOverviewRow } from '../engine/plans'

export const hostStoreColumns = [
  'name',
  'state',
  'sellers',
  'items',
  'sales30',
  'lastActivity',
] as const
export type HostStoreColumn = (typeof hostStoreColumns)[number]

export function sortHostStores(
  rows: readonly PlanOverviewRow[],
  activity: Record<string, ActivityRow>,
  column: HostStoreColumn,
  direction: 'asc' | 'desc',
  locale: string,
  states: Record<string, string>,
) {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  })
  function value(row: PlanOverviewRow): string | number | null {
    const a = activity[row.tenant_id]
    switch (column) {
      case 'name':
        return row.name
      case 'state':
        return states[row.state] ?? row.state
      case 'lastActivity':
        return a?.last_activity ? Date.parse(a.last_activity) : null
      case 'sales30':
        return a?.sales_30d ?? null
      default:
        return a?.[column] ?? null
    }
  }
  return [...rows].sort((a, b) => {
    const av = value(a),
      bv = value(b)
    // Missing activity is unknown, not zero, and stays last in either direction.
    if (av === null && bv !== null) return 1
    if (av !== null && bv === null) return -1
    const comparison =
      av === null || bv === null
        ? 0
        : typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : collator.compare(String(av), String(bv))
    return comparison
      ? comparison * (direction === 'asc' ? 1 : -1)
      : collator.compare(a.name, b.name) ||
          a.tenant_id.localeCompare(b.tenant_id)
  })
}
