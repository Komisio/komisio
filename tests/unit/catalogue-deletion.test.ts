import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  catalogueDeleteInput,
  deleteCatalogueRecord,
} from '../../lib/engine/catalogue-deletion'

const input = {
  tenantId: 'f0000000-0000-4000-8000-000000003421',
  kind: 'type',
  key: 'jacket',
}
describe('catalogue deletion boundary', () => {
  it('rejects unknown kinds, extra fields and invalid identifiers', () => {
    expect(catalogueDeleteInput.safeParse(input).success).toBe(true)
    for (const invalid of [
      { ...input, kind: 'seller' },
      { ...input, force: true },
      { ...input, key: '../../other' },
      { ...input, kind: 'category' },
    ])
      expect(catalogueDeleteInput.safeParse(invalid).success).toBe(false)
  })
  it('preserves structured usage and checks the returned identity', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: false, usage: { items: 2, profiles: 1 } },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient
    expect(await deleteCatalogueRecord(client, input)).toEqual({
      ok: false,
      usage: { items: 2, profiles: 1 },
    })
    expect(rpc).toHaveBeenCalledWith('delete_catalogue_record', {
      p_tenant: input.tenantId,
      p_kind: 'type',
      p_key: 'jacket',
    })
    rpc.mockResolvedValue({
      data: { ok: true, kind: 'type', key: 'other' },
      error: null,
    })
    await expect(deleteCatalogueRecord(client, input)).rejects.toThrow(
      'REQUEST_FAILED',
    )
  })
  it('does not expose database internals', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'private table detail' },
    })
    await expect(
      deleteCatalogueRecord({ rpc } as unknown as SupabaseClient, input),
    ).rejects.toThrow('REQUEST_FAILED')
  })
})
