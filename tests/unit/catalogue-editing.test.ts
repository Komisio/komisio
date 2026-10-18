import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  catalogueEditCommand,
  editCatalogue,
} from '../../lib/engine/edit-catalogue'
const command = {
  kind: 'category',
  tenantId: 'f0000000-0000-4000-8000-000000003510',
  requestId: 'f0000000-0000-4000-8000-000000003511',
  id: 'f0000000-0000-4000-8000-000000003512',
  expected: 0,
  name: 'Books',
  labels: { en: 'Books' },
  active: true,
}
describe('catalogue editing boundary', () => {
  it('accepts one locale but rejects unknown locales, empty labels and missing concurrency tokens', () => {
    expect(catalogueEditCommand.safeParse(command).success).toBe(true)
    for (const value of [
      { ...command, labels: {} },
      { ...command, labels: { xx: 'Books' } },
      { ...command, expected: undefined },
      { ...command, force: true },
    ])
      expect(catalogueEditCommand.safeParse(value).success).toBe(false)
  })
  it('checks the mutation receipt before reading current presentation', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'other', error: null })
    await expect(
      editCatalogue({ rpc } as unknown as SupabaseClient, command),
    ).rejects.toThrow('REQUEST_FAILED')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves a concurrency refusal without exposing database internals', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { message: 'CATALOGUE_CHANGED' } })
    const client = { rpc } as unknown as SupabaseClient
    await expect(editCatalogue(client, command)).rejects.toThrow(
      'CATALOGUE_CHANGED',
    )
    rpc.mockResolvedValue({ error: { message: 'private internal detail' } })
    await expect(editCatalogue(client, command)).rejects.toThrow(
      'REQUEST_FAILED',
    )
  })
})
