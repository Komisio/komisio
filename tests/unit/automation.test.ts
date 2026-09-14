import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  automationIdentity,
  enableAutomation,
  readAutomation,
} from '../../lib/engine/automation'

const tenant = '10000000-0000-4000-8000-000000000001'
const request = '20000000-0000-4000-8000-000000000002'

describe('automation identity', () => {
  it('requires a configured e-mail and a long password', () => {
    expect(automationIdentity({})).toBeNull()
    expect(
      automationIdentity({
        KOMISIO_AUTOMATION_EMAIL: 'Automation@Example.test ',
        KOMISIO_AUTOMATION_PASSWORD: 'short',
      }),
    ).toBeNull()
    expect(
      automationIdentity({
        KOMISIO_AUTOMATION_EMAIL: 'Automation@Example.test ',
        KOMISIO_AUTOMATION_PASSWORD: 'x'.repeat(24),
      }),
    ).toEqual({ email: 'automation@example.test', password: 'x'.repeat(24) })
  })
  it('passes the configured e-mail, never a caller value', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: {
        id: request,
        scope: 'zettle_pull',
        enabledAt: '2026-09-14T10:00:00+00:00',
        accepted: false,
        acceptedAt: null,
        disabledAt: null,
      },
      error: null,
    }))
    const client = { rpc } as unknown as SupabaseClient
    const grant = await enableAutomation(
      client,
      tenant,
      request,
      'zettle_pull',
      {
        KOMISIO_AUTOMATION_EMAIL: 'automation@example.test',
        KOMISIO_AUTOMATION_PASSWORD: 'x'.repeat(24),
      },
    )
    expect(grant.accepted).toBe(false)
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_identity_email: 'automation@example.test',
    })
    await expect(
      enableAutomation(client, tenant, request, 'zettle_pull', {}),
    ).rejects.toThrow('AUTOMATION_NOT_CONFIGURED')
  })
  it('reads null during the deploy gap and refuses otherwise', async () => {
    const gap = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })),
    } as unknown as SupabaseClient
    expect(await readAutomation(gap, tenant)).toBeNull()
    const denied = {
      rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    } as unknown as SupabaseClient
    await expect(readAutomation(denied, tenant)).rejects.toThrow('FORBIDDEN')
  })
})
