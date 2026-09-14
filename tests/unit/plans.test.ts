import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  activatePlanCommand,
  planStatus,
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
