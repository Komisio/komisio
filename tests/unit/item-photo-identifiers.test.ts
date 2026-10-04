import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readItemPhotos } from '../../lib/engine/item-photos'
import { itemPhotoCommand } from '../../lib/engine/item-photo-types'

const tenant = 'f0000000-0000-4000-8000-000000000211'
const legacyItem = '01234567-89ab-0def-0123-456789abcdef'
const legacyPhoto = 'abcdef01-2345-f678-0123-456789abcdef'

describe('persisted item photo identifiers', () => {
  it('reads legacy database identifiers in both request and photo state', async () => {
    const state = {
      itemId: legacyItem,
      revision: 0,
      defaultPhotoId: legacyPhoto,
      photos: [
        {
          id: legacyPhoto,
          bucket: 'reception-photos',
          path: 'stored-photo.jpg',
        },
      ],
    }
    const rpc = vi.fn().mockResolvedValue({ data: [state], error: null })
    const client = { rpc } as unknown as SupabaseClient
    expect(await readItemPhotos(client, tenant, [legacyItem])).toEqual([state])
    expect(rpc).toHaveBeenCalledWith('item_photo_state', {
      p_tenant: tenant,
      p_items: [legacyItem],
    })
    await expect(
      readItemPhotos(client, tenant, ['not-an-id']),
    ).rejects.toThrow()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('allows selecting an existing legacy photo without relaxing operation IDs', () => {
    const command = {
      tenantId: tenant,
      requestId: tenant,
      itemId: legacyItem,
      photoId: legacyPhoto,
      expected: 0,
      action: 'default',
    }
    expect(itemPhotoCommand.safeParse(command).success).toBe(true)
    expect(
      itemPhotoCommand.safeParse({ ...command, requestId: legacyItem }).success,
    ).toBe(false)
    expect(
      itemPhotoCommand.safeParse({ ...command, itemId: 'invalid' }).success,
    ).toBe(false)
  })
})
