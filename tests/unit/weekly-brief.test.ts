import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  previousSunday,
  sendWeeklyBriefs,
  weekStart,
} from '../../lib/engine/weekly-brief'

const tenant = '10000000-0000-4000-8000-000000000001'
const zero = {
  salesCount: 0,
  linesCount: 0,
  grossOre: 0,
  vatOre: 0,
  netOre: 0,
  commissionOre: 0,
  commissionVatOre: 0,
  sellerCreditOre: 0,
  returnsCount: 0,
  refundsOre: 0,
  creditReversedOre: 0,
  payoutsPaidCount: 0,
  payoutsPaidOre: 0,
}

describe('weekly brief', () => {
  it('finds the Monday of the local week and the Sunday before it', () => {
    expect(weekStart(new Date('2026-09-14T05:30:00Z'))).toBe('2026-09-14')
    expect(weekStart(new Date('2026-09-20T22:30:00Z'))).toBe('2026-09-21')
    expect(weekStart(new Date('2026-09-13T10:00:00Z'))).toBe('2026-09-07')
    expect(previousSunday('2026-09-14')).toBe('2026-09-13')
  })
  it('mails last week to every owner of a due store and records once per week', async () => {
    const calls: Record<string, unknown>[] = []
    const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'due_weekly_briefs')
        return {
          data: [
            {
              tenant_id: tenant,
              store_name: 'Preloved',
              locale: 'sv',
              emails: ['owner@example.test'],
            },
          ],
          error: null,
        }
      if (fn === 'economy_brief')
        return {
          data: {
            kind: 'week',
            anchor: args?.p_end,
            currency: 'SEK',
            timeZone: 'Europe/Stockholm',
            period: { from: '2026-09-07', to: '2026-09-13' },
            previousPeriod: { from: '2026-08-31', to: '2026-09-06' },
            current: { ...zero, salesCount: 2, grossOre: 30000 },
            previous: zero,
            days: [],
            bestDay: null,
            itemsAccepted: 1,
            previousItemsAccepted: 0,
            liability: {
              availableOre: 0,
              reservedOre: 0,
              owedOre: 0,
              sellersWithEntries: 0,
            },
            openPayouts: { count: 0, amountOre: 0 },
          },
          error: null,
        }
      calls.push({ fn, ...args })
      return { data: true, error: null }
    })
    const transport = vi.fn(
      async (_input: { to: string; subject: string; text: string }) => ({
        status: 'sent' as const,
        providerMessageId: 'm1',
      }),
    )
    const result = await sendWeeklyBriefs(
      { rpc } as unknown as SupabaseClient,
      'https://app.example.test',
      {},
      transport,
      new Date('2026-09-14T05:30:00Z'),
    )
    expect(result.week).toBe('2026-09-14')
    expect(result.results).toEqual([{ tenantId: tenant, delivery: 'sent' }])
    const sent = transport.mock.calls[0][0]
    expect(sent.to).toBe('owner@example.test')
    expect(sent.subject).toContain('Preloved')
    expect(sent.text).toContain('300.00 SEK')
    expect(sent.text).toContain('https://app.example.test/intake/economy')
    expect(calls).toEqual([
      {
        fn: 'record_brief_send',
        p_tenant: tenant,
        p_week_start: '2026-09-14',
        p_recipients: 1,
        p_delivery: 'sent',
      },
    ])
  })
})
