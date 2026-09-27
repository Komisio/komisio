import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readBagWorkSummary } from '../../lib/engine/bag-work-summary'
const tenant = '10000000-0000-4000-8000-000000000001',
  bag = '20000000-0000-4000-8000-000000000001'
describe('handover progress boundary', () => {
  it('does not invent zero counts while the migration is missing', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: 'PGRST202' } })
    expect(
      await readBagWorkSummary(
        { rpc } as unknown as SupabaseClient,
        tenant,
        bag,
      ),
    ).toBeNull()
  })
  it('does not hide authorization failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: '42501' } })
    await expect(
      readBagWorkSummary({ rpc } as unknown as SupabaseClient, tenant, bag),
    ).rejects.toThrow('Unable to read handover progress')
  })
  it('rejects invalid counts and direct navigation targets', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        accepted: 1,
        drafts: -1,
        receptions: 0,
        nextDraft: 'not-an-id',
        nextReception: null,
      },
    })
    await expect(
      readBagWorkSummary({ rpc } as unknown as SupabaseClient, tenant, bag),
    ).rejects.toThrow()
  })
})
