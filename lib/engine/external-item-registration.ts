import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadReceptionPhoto, photoLimit } from './reception-photos'

export const externalRegistrationCommand = z.strictObject({
  tenantId: z.uuid(),
  commandId: z.uuid(),
  guaranteeId: z.uuid(),
  description: z.string().trim().min(1).max(1000),
  priceOre: z.string().regex(/^[1-9]\d{0,7}$/),
})
const preparation = z.object({
  sessionId: z.guid(),
  ownerId: z.uuid(),
  photoIds: z.array(z.uuid()).min(1).max(8),
  itemId: z.guid().nullable(),
})

/** Copy immutable evidence with staff RLS; SQL atomically registers the item. */
export async function registerExternalItem(
  client: SupabaseClient,
  input: unknown,
) {
  const c = externalRegistrationCommand.parse(input)
  const started = await client.rpc('prepare_external_item_registration', {
    p_tenant: c.tenantId,
    p_guarantee: c.guaranteeId,
  })
  if (started.error) throw new Error(started.error.message)
  const state = preparation.parse(started.data)
  if (!state.itemId) {
    for (const photoId of state.photoIds) {
      const source = await client.storage
        .from('external-item-photos')
        .download(`${state.ownerId}/${photoId}.jpg`)
      if (source.error || !source.data || source.data.size > photoLimit)
        throw new Error('PHOTO_NOT_FOUND')
      await uploadReceptionPhoto(
        client,
        { tenantId: c.tenantId, sessionId: state.sessionId, photoId },
        new Uint8Array(await source.data.arrayBuffer()),
      )
    }
  }
  // A known item still requires SQL to verify the exact command and actor.
  const result = await client.rpc('register_external_item', {
    p_tenant: c.tenantId,
    p_id: c.commandId,
    p_guarantee: c.guaranteeId,
    p_description: c.description,
    p_price_ore: c.priceOre,
  })
  if (result.error) throw new Error(result.error.message)
  const itemId = z.guid().parse(result.data)
  if (state.itemId && state.itemId !== itemId)
    throw new Error('UNCONFIRMED_RESULT')
  return { id: c.commandId, itemId }
}
