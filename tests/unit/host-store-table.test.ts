import { expect, it } from 'vitest'
import { sortHostStores } from '../../lib/platform/host-store-table'
import type { ActivityRow, PlanOverviewRow } from '../../lib/engine/plans'

const row = (id: string, name: string, created: string): PlanOverviewRow => ({
  tenant_id: id,
  name,
  slug: id,
  created_at: created,
  state: 'active',
  provider: 'none',
  active_until: null,
  trial_ends_at: null,
  grace_ends_at: null,
})
const rows = [
  row('a', 'Store 10', '2026-01-01T00:00:00Z'),
  row('b', 'Store 2', '2026-02-01T00:00:00Z'),
  row('c', 'Unknown', '2026-03-01T00:00:00Z'),
]
const activity: Record<string, ActivityRow> = {
  a: {
    tenant_id: 'a',
    members: 1,
    sellers: 2,
    items: 12,
    sales_30d: 0,
    last_activity: '2026-09-01T23:00:00Z',
  },
  b: {
    tenant_id: 'b',
    members: 2,
    sellers: 3,
    items: 3,
    sales_30d: 9,
    last_activity: '2026-09-02T02:00:00+04:00',
  },
}
const sort = (
  column: Parameters<typeof sortHostStores>[2],
  direction: 'asc' | 'desc',
) =>
  sortHostStores(rows, activity, column, direction, 'sv-SE', {
    active: 'Aktiv',
  }).map((r) => r.tenant_id)
it('sorts names naturally without changing the source rows', () => {
  expect(sort('name', 'asc')).toEqual(['b', 'a', 'c'])
  expect(rows.map((r) => r.tenant_id)).toEqual(['a', 'b', 'c'])
})
it('sorts numeric counts and keeps missing activity last in both directions', () => {
  expect(sort('items', 'asc')).toEqual(['b', 'a', 'c'])
  expect(sort('items', 'desc')).toEqual(['a', 'b', 'c'])
  expect(sort('sales30', 'asc')).toEqual(['a', 'b', 'c'])
})
it('sorts timestamps by instant rather than formatted date or offset', () => {
  expect(sort('lastActivity', 'asc')).toEqual(['b', 'a', 'c'])
  expect(sort('lastActivity', 'desc')).toEqual(['a', 'b', 'c'])
})
