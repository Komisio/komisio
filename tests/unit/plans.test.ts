import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  activatePlanCommand,
  activityRow,
  planStatus,
  readHostActivity,
  readPlanStatus,
} from '../../lib/engine/plans'

describe('plans', () => {
  it('parses the status the database returns, with and without billing', () => {
    expect(
      planStatus.parse({ billing: false, state: 'active', writable: true }),
    ).toMatchObject({ billing: false, writable: true })
    const trial = planStatus.parse({
      billing: true,
      state: 'trial',
      writable: true,
      provider: 'none',
      trialEndsAt: '2026-10-14T10:00:00+00:00',
      graceEndsAt: null,
      activeUntil: null,
      daysLeft: 30,
    })
    expect(trial.daysLeft).toBe(30)
    expect(() =>
      planStatus.parse({ billing: true, state: 'unknown', writable: false }),
    ).toThrow()
  })
  it('keys host activity by store and treats a missing read as empty', async () => {
    expect(
      activityRow.safeParse({
        tenant_id: '10000000-0000-4000-8000-000000000001',
        members: 2,
        sellers: 1,
        items: 0,
        sales_30d: 0,
        last_activity: null,
      }).success,
    ).toBe(true)
    const row = {
      tenant_id: '10000000-0000-4000-8000-000000000001',
      members: 2,
      sellers: 1,
      items: 3,
      sales_30d: 1,
      last_activity: '2026-09-14T10:00:00+00:00',
    }
    const client = {
      rpc: vi.fn(async () => ({ data: [row], error: null })),
    } as unknown as SupabaseClient
    const activity = await readHostActivity(client)
    expect(activity.get(row.tenant_id)?.items).toBe(3)
    const gap = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })),
    } as unknown as SupabaseClient
    expect((await readHostActivity(gap)).size).toBe(0)
  })
  it('validates the host activation command', () => {
    expect(
      activatePlanCommand.safeParse({
        action: 'activatePlan',
        tenantId: '10000000-0000-4000-8000-000000000001',
        until: null,
        reason: ' invoice customer ',
      }).success,
    ).toBe(true)
    expect(
      activatePlanCommand.safeParse({
        action: 'activatePlan',
        tenantId: '10000000-0000-4000-8000-000000000001',
        until: 'tomorrow',
        reason: 'x',
      }).success,
    ).toBe(false)
  })
  it('reads null during the deploy gap', async () => {
    const gap = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })),
    } as unknown as SupabaseClient
    expect(
      await readPlanStatus(gap, '10000000-0000-4000-8000-000000000001'),
    ).toBeNull()
  })
})
