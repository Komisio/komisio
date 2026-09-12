import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reviewToken } from './seller-review'
import { photoType } from '../media/reception-photo'
import { receptionDerivative } from '../media/reception-image'

/** Client must carry the user's JWT and x-komisio-review-token for Storage RLS. */
export async function readSellerPhoto(
  client: SupabaseClient,
  token: string,
  photoId: string,
) {
  const result = await client.rpc('read_seller_review_photo', {
    p_token: reviewToken.parse(token),
    p_photo: z.uuid().parse(photoId),
  })
  if (result.error) return null
  const path = z
    .string()
    .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/)
    .parse(result.data)
  const photo = await client.storage
    .from('seller-reception-photos')
    .download(path)
  if (photo.error || photo.data.size > 1024 * 1024) return null
  const bytes = new Uint8Array(await photo.data.arrayBuffer())
  if (photoType(bytes).mime !== 'image/jpeg') return null
  // Revalidate/minimize even an object uploaded by another authenticated adapter.
  return receptionDerivative(bytes)
}
