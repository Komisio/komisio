import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  photoDuplicates,
  readPhotoDuplicates,
} from '../../lib/engine/photo-duplicates'

const tenant = '10000000-0000-4000-8000-000000000001'
const session = '10000000-0000-4000-8000-000000000002'
const photo = '10000000-0000-4000-8000-000000000003'

describe('photo duplicates', () => {
  it('parses earlier sightings and rejects unbounded lists', () => {
    const one = {
      sessionId: session,
      photoId: photo,
      seenAt: '2026-09-14T10:00:00+00:00',
      sellerId: '10000000-0000-4000-8000-000000000004',
      sellerName: 'Anna',
    }
    expect(
      photoDuplicates.safeParse({ photos: [{ photoId: photo, seen: [one] }] })
        .success,
    ).toBe(true)
    expect(
      photoDuplicates.safeParse({
        photos: [{ photoId: photo, seen: Array(6).fill(one) }],
      }).success,
    ).toBe(false)
  })
  it('shows nothing during the deploy gap and refuses other errors', async () => {
    const gap = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })),
    } as unknown as SupabaseClient
    expect(await readPhotoDuplicates(gap, tenant, session)).toBeNull()
    const denied = {
      rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    } as unknown as SupabaseClient
    await expect(readPhotoDuplicates(denied, tenant, session)).rejects.toThrow(
      'FORBIDDEN',
    )
  })
})
