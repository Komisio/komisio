import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isTransientReadError,
  readBagWorkSummary,
} from '../../lib/engine/bag-work-summary'
const tenant = '10000000-0000-4000-8000-000000000001',
  bag = '20000000-0000-4000-8000-000000000001'
const read = (rpcResult: unknown) =>
  readBagWorkSummary(
    { rpc: vi.fn().mockResolvedValue(rpcResult) } as unknown as SupabaseClient,
    tenant,
    bag,
  )
describe('handover progress boundary', () => {
  it('does not invent zero counts while the migration is missing', async () => {
    expect(await read({ error: { code: 'PGRST202' } })).toBeNull()
  })
  it('degrades to unavailable only for transient read failures', async () => {
    for (const error of [
      {
        code: '57014',
        message: 'canceling statement due to statement timeout',
      },
      { code: '08006', message: 'connection failure' },
      { code: '53300', message: 'too many connections' },
      { code: '40001', message: 'could not serialize access' },
      { code: 'PGRST001', message: 'Could not query the database' },
      { code: '', message: 'TypeError: fetch failed' },
    ]) {
      expect(isTransientReadError(error), error.message).toBe(true)
      expect(await read({ error }), error.message).toBeNull()
    }
  })
  it('does not hide authorization, business or validation failures', async () => {
    for (const error of [
      { code: '42501', message: 'FORBIDDEN' },
      { code: 'P0001', message: 'BAG_NOT_FOUND' },
      { code: 'P0001', message: 'INVALID_INPUT' },
      { code: '22P02', message: 'invalid input syntax for type uuid' },
      { code: 'PGRST301', message: 'JWT expired' },
      { code: '', message: 'unexpected' },
    ]) {
      expect(isTransientReadError(error), error.message).toBe(false)
      await expect(read({ error }), error.message).rejects.toThrow(
        'Unable to read handover progress',
      )
    }
  })
  it('rejects invalid counts and direct navigation targets', async () => {
    await expect(
      read({
        data: {
          accepted: 1,
          drafts: -1,
          receptions: 0,
          nextDraft: 'not-an-id',
          nextReception: null,
        },
      }),
    ).rejects.toThrow()
  })
  it('accepts existing row ids that are not RFC-version shaped', async () => {
    const result = await read({
      data: {
        accepted: 0,
        drafts: 1,
        receptions: 0,
        nextDraft: '30000000-0000-0000-0000-000000000001',
        nextReception: null,
      },
    })
    expect(result?.nextDraft).toBe('30000000-0000-0000-0000-000000000001')
  })
})
