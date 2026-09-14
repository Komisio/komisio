import { describe, expect, it } from 'vitest'
import {
  openDays,
  reconciliation,
  type Reconciliation,
} from '../../lib/engine/reconciliation'

const base: Reconciliation = {
  from: '2026-09-01',
  to: '2026-09-30',
  timeZone: 'Europe/Stockholm',
  currency: 'SEK',
  mapVersion: 2,
  days: [
    {
      date: '2026-09-01',
      status: 'sent',
      salesCount: 1,
      grossOre: 7900,
      close: {
        id: '10000000-0000-4000-8000-000000000001',
        version: 1,
        generatedAt: '2026-09-14T08:00:00+00:00',
      },
      export: {
        id: '20000000-0000-4000-8000-000000000002',
        mapId: '30000000-0000-4000-8000-000000000003',
        createdAt: '2026-09-14T09:00:00+00:00',
      },
      send: {
        id: '40000000-0000-4000-8000-000000000004',
        status: 'sent',
        voucherSeries: 'A',
        voucherNumber: 8,
        errorCode: '',
        createdAt: '2026-09-14T09:30:00+00:00',
      },
    },
    {
      date: '2026-09-02',
      status: 'no_close',
      salesCount: 2,
      grossOre: 30000,
      close: null,
      export: null,
      send: null,
    },
    {
      date: '2026-09-03',
      status: 'send_pending',
      salesCount: 1,
      grossOre: 100,
      close: null,
      export: null,
      send: null,
    },
  ],
  counts: { sent: 1, no_close: 1, send_pending: 1 },
}

describe('reconciliation', () => {
  it('parses string öre and lists the days that need a person', () => {
    const parsed = reconciliation.parse({
      ...base,
      days: base.days.map((d) => ({ ...d, grossOre: String(d.grossOre) })),
    })
    expect(parsed.days[0].grossOre).toBe(7900)
    expect(openDays(parsed).map((d) => d.date)).toEqual(['2026-09-02'])
  })
  it('refuses unknown statuses', () => {
    expect(() =>
      reconciliation.parse({
        ...base,
        days: [{ ...base.days[1], status: 'unknown' }],
      }),
    ).toThrow()
  })
})
