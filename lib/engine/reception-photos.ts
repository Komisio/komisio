import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readReceptionSession } from './reception-store'
export const photoLimit = 3 * 1024 * 1024
const context = z.strictObject({
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  photoId: z.uuid(),
})
function dimensions(width: number, height: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 20000000
  )
    throw new Error('INVALID_IMAGE')
}
/** Signature, dimensions and byte bounds, not authenticity or full decoding. */
export function photoType(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.length > photoLimit)
    throw new Error('INVALID_IMAGE')
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      const length = (bytes[offset] << 8) | bytes[offset + 1]
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        dimensions(
          (bytes[offset + 5] << 8) | bytes[offset + 6],
          (bytes[offset + 3] << 8) | bytes[offset + 4],
        )
        return { mime: 'image/jpeg', ext: 'jpg' }
      }
      offset += length
    }
    throw new Error('INVALID_IMAGE')
  }
  if (
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  ) {
    const b = Buffer.from(bytes)
    if (
      b.length < 24 ||
      b.readUInt32BE(8) !== 13 ||
      b.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('INVALID_IMAGE')
    dimensions(b.readUInt32BE(16), b.readUInt32BE(20))
    return { mime: 'image/png', ext: 'png' }
  }
  throw new Error('INVALID_IMAGE')
}
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
  const reference = `${c.tenantId}/${c.sessionId}/${c.photoId}.${type.ext}`
  const bucket = client.storage.from('reception-photos')
  const result = await bucket.upload(reference, bytes, {
    contentType: type.mime,
    upsert: false,
    cacheControl: '0',
  })
  if (result.error) {
    // Lost-success retry can reuse an immutable object only when all bytes match.
    const existing = await bucket.download(reference)
    if (
      existing.error ||
      existing.data.size > photoLimit ||
      !Buffer.from(await existing.data.arrayBuffer()).equals(Buffer.from(bytes))
    )
      throw new Error('PHOTO_UPLOAD_FAILED')
  }
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
