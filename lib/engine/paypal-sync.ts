import type { SupabaseClient } from '@supabase/supabase-js'
import type { PilotEnvironment } from '../../extensions/zettle/auth'
import { exportZettleItem } from './zettle-stock'
import { exportZettleImage } from './zettle-images'
import { readSyncPreferences } from './sync-preferences'
import { readPayPalItemStatus } from './paypal-status'

/** One explicit export, with optional image transfer after product acknowledgement. */
export async function syncPayPalItem(
  client: SupabaseClient,
  tenantId: string,
  requestId: string,
  itemId: string,
  source: PilotEnvironment,
) {
  const preferences = await readSyncPreferences(client, tenantId)
  const images = preferences?.find((p) => p.provider === 'paypal')?.images
  if (images) {
    const state = (await readPayPalItemStatus(client, tenantId, [itemId]))?.[0]
    // Complete a recorded upload first after a lost association acknowledgement.
    // Otherwise a product retry could mistake the already attached new image
    // for an external edit. Changed product snapshots still stop for review.
    if (
      state?.imageStatus === 'uploaded' &&
      state.productStatus === 'synced' &&
      ['synced', 'attention'].includes(state.status)
    ) {
      await exportZettleImage(
        client,
        tenantId,
        requestId,
        itemId,
        source,
        undefined,
        true,
      )
    }
  }
  const product = await exportZettleItem(
    client,
    tenantId,
    requestId,
    itemId,
    source,
  )
  if (!images) return product
  const image = await exportZettleImage(
    client,
    tenantId,
    requestId,
    itemId,
    source,
    undefined,
    true,
  )
  return { ...product, image: image.image }
}
