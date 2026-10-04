import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { photoLimit, photoType } from '../media/reception-photo'
import { receptionDerivative } from '../media/reception-image'

import { itemPhotoState, itemPhotoCommand } from './item-photo-types'
export { itemPhotoState, itemPhotoCommand } from './item-photo-types'
export type { ItemPhotoState } from './item-photo-types'
export async function readItemPhotos(
  client: SupabaseClient,
  tenantId: string,
  itemIds: string[],
) {
  const ids = z.array(z.uuid()).max(20).parse(itemIds)
  if (!ids.length) return []
  const r = await client.rpc('item_photo_state', {
    p_tenant: z.uuid().parse(tenantId),
    p_items: ids,
  })
  // Additive rollout: omit the gallery until its migration is present.
  if (r.error?.code === 'PGRST202') return []
  if (r.error) throw new Error('FORBIDDEN')
  return z.array(itemPhotoState).parse(r.data)
}
export async function changeItemPhoto(
  client: SupabaseClient,
  input: unknown,
  bytes?: Uint8Array,
) {
  const c = itemPhotoCommand.parse(input)
  if (c.action === 'add') {
    if (!bytes) throw new Error('INVALID_IMAGE')
    photoType(bytes)
    const role = await client.rpc('tenant_role', { p_tenant: c.tenantId })
    if (role.error || !['owner', 'admin', 'staff'].includes(role.data))
      throw new Error('FORBIDDEN')
    if (!(await readItemPhotos(client, c.tenantId, [c.itemId])).length)
      throw new Error('ITEM_NOT_FOUND')
    const normalized = await receptionDerivative(bytes)
    const path = `${c.tenantId}/${c.itemId}/${c.photoId}.jpg`
    const bucket = client.storage.from('item-photos')
    const uploaded = await bucket.upload(path, normalized, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '0',
    })
    if (uploaded.error) {
      // A retry may find an already stored immutable upload; never overwrite it.
      const prior = await bucket.download(path)
      if (
        prior.error ||
        prior.data.size > 1024 * 1024 ||
        !Buffer.from(await prior.data.arrayBuffer()).equals(normalized)
      )
        throw new Error('PHOTO_UPLOAD_FAILED')
    }
  }
  const r = await client.rpc('change_item_photo', {
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_item: c.itemId,
    p_expected: c.expected,
    p_action: c.action,
    p_photo: c.photoId,
  })
  if (r.error) throw new Error(r.error.message)
  return {
    requestId: c.requestId,
    state: (await readItemPhotos(client, c.tenantId, [c.itemId]))[0],
  }
}
export async function readItemPhotoBytes(
  client: SupabaseClient,
  tenantId: string,
  itemId: string,
  photoId: string,
) {
  const id = z.uuid().parse(photoId)
  const state = (await readItemPhotos(client, tenantId, [itemId]))[0]
  const photo = state?.photos.find((p) => p.id === id)
  if (!photo) return null
  const r = await client.storage.from(photo.bucket).download(photo.path)
  if (r.error || r.data.size > photoLimit) return null
  const bytes = new Uint8Array(await r.data.arrayBuffer())
  return { bytes, ...photoType(bytes) }
}
