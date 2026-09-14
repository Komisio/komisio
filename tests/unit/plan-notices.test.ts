import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderNotice, sendDueNotices } from '../../lib/engine/plan-notices'

const tenant = '10000000-0000-4000-8000-000000000001'
const notice = {
  tenant_id: tenant,
  store_name: 'Preloved',
  kind: 'trial_week' as const,
  deadline: '2026-10-14T21:59:59+00:00',
  locale: 'sv',
  emails: ['owner@example.test', 'second@example.test'],
}

describe('plan notices', () => {
  it('renders fixed wording with the store, the date and the settings link', () => {
    const sv = renderNotice(notice, 'https://app.example.test')
    expect(sv.subject).toContain('Preloved')
    expect(sv.text).toContain('2026-10-14')
    expect(sv.text).toContain('https://app.example.test/settings')
    expect(sv.text).not.toContain('{')
    const en = renderNotice(
      { ...notice, locale: 'en', kind: 'trial_ended' },
      'https://app.example.test',
    )
    expect(en.subject).toBe('Preloved is now read-only')
    expect(en.text).not.toContain('{')
  })
  it('sends to every owner, records once per store and kind, and never retries a store without owners', async () => {
    const calls: Record<string, unknown>[] = []
    const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'due_plan_notices')
        return {
          data: [notice, { ...notice, kind: 'trial_ended', emails: [] }],
          error: null,
        }
      calls.push({ fn, ...args })
      return { data: true, error: null }
    })
    const transport = vi.fn(async (input: { to: string }) => ({
      status: input.to.startsWith('owner')
        ? ('sent' as const)
        : ('restricted' as const),
      providerMessageId: '',
    }))
    const result = await sendDueNotices(
      { rpc } as unknown as SupabaseClient,
      'https://app.example.test',
      {},
      transport,
    )
    expect(transport).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      { tenantId: tenant, kind: 'trial_week', delivery: 'sent' },
      { tenantId: tenant, kind: 'trial_ended', delivery: 'none' },
    ])
    expect(calls).toEqual([
      {
        fn: 'record_plan_notice',
        p_tenant: tenant,
        p_kind: 'trial_week',
        p_recipients: 2,
        p_delivery: 'sent',
      },
      {
        fn: 'record_plan_notice',
        p_tenant: tenant,
        p_kind: 'trial_ended',
        p_recipients: 0,
        p_delivery: 'none',
      },
    ])
  })
})
