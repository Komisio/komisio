import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readReceptionSession } from './reception-store'
import { photoLimit, photoType } from '../media/reception-photo'
import { receptionDerivative } from '../media/reception-image'
export { photoLimit, photoType } from '../media/reception-photo'
const context = z.strictObject({
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  photoId: z.uuid(),
})
export async function uploadReceptionPhoto(
  client: SupabaseClient,
  input: unknown,
  bytes: Uint8Array,
) {
  const c = context.parse(input),
    type = photoType(bytes)
  const session = await readReceptionSession(client, c.tenantId, c.sessionId)
  if (!session) throw new Error('NOT_FOUND')
  const { data: role, error: roleError } = await client.rpc('tenant_role', {
    p_tenant: c.tenantId,
  })
  if (roleError || !['owner', 'admin', 'staff'].includes(role))
    throw new Error('FORBIDDEN')
  const derivative = await receptionDerivative(bytes)
  const reference = `${c.tenantId}/${c.sessionId}/${c.photoId}.${type.ext}`
  await immutableUpload(
    client,
    'reception-photos',
    reference,
    bytes,
    type.mime,
    photoLimit,
  )
  await immutableUpload(
    client,
    'seller-reception-photos',
    `${c.tenantId}/${c.sessionId}/${c.photoId}.jpg`,
    derivative,
    'image/jpeg',
    1024 * 1024,
  )
  return { id: c.photoId, kind: 'photo' as const, reference, observation: '' }
}
export async function readReceptionPhoto(
  client: SupabaseClient,
  input: unknown,
) {
  const c = context.parse(input),
    state = await readReceptionSession(client, c.tenantId, c.sessionId)
  if (!state || state.status !== 'ready') return null
  const source = state.session.sources.find(
    (s) => s.id === c.photoId && s.kind === 'photo',
  )
  if (
    !source ||
    ![
      `${c.tenantId}/${c.sessionId}/${c.photoId}.png`,
      `${c.tenantId}/${c.sessionId}/${c.photoId}.jpg`,
    ].includes(source.reference)
  )
    return null
  const result = await client.storage
    .from('reception-photos')
    .download(source.reference)
  if (result.error || result.data.size > photoLimit) return null
  const bytes = new Uint8Array(await result.data.arrayBuffer())
  return { bytes, ...photoType(bytes) }
}

async function immutableUpload(
  client: SupabaseClient,
  bucketName: string,
  reference: string,
  bytes: Uint8Array,
  mime: string,
  limit: number,
) {
  const bucket = client.storage.from(bucketName)
  const result = await bucket.upload(reference, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: '0',
  })
  if (result.error) {
    // A lost-success retry never overwrites an immutable object.
    const existing = await bucket.download(reference)
    if (
      existing.error ||
      existing.data.size > limit ||
      !Buffer.from(await existing.data.arrayBuffer()).equals(Buffer.from(bytes))
    )
      throw new Error('PHOTO_UPLOAD_FAILED')
  }
}
