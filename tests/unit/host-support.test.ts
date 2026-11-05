import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeHostSupport,
  hostSupportCommand,
  readHostSupport,
} from '../../lib/engine/host-support'

function client(result: object) {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient
}
describe('host support boundary', () => {
  it('fails closed when support state cannot be read', async () => {
    await expect(
      readHostSupport(client({ error: { code: '57014' } })),
    ).rejects.toThrow('SUPPORT_CONTEXT_FAILED')
    await expect(
      readHostSupport(client({ data: { available: true } })),
    ).rejects.toThrow()
  })
  it('grants nothing before migration or without a visit', async () => {
    expect(
      await readHostSupport(client({ error: { code: 'PGRST202' } })),
    ).toBeNull()
    expect(await readHostSupport(client({ data: null }))).toBeNull()
  })
  it('rejects blank reasons and client supplied actor, duration or role', () => {
    const base = {
      action: 'start',
      id: '77700000-0000-4000-8000-000000000001',
      tenantId: '77700000-0000-4000-8000-000000000002',
      reason: 'Investigate',
    }
    for (const extra of [
      { reason: ' ' },
      { expiresAt: '2099-01-01' },
      { role: 'owner' },
      { userId: base.id },
    ])
      expect(hostSupportCommand.safeParse({ ...base, ...extra }).success).toBe(
        false,
      )
  })
  it('preserves database refusals instead of fabricating a successful exit', async () => {
    await expect(
      executeHostSupport(client({ error: { message: 'FORBIDDEN' } }), {
        action: 'end',
        id: '77700000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow('FORBIDDEN')
  })
})
