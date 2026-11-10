import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionDerivative } from '../media/reception-image'
import { photoType } from '../media/reception-photo'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/)
export const externalItemSubmission = z.strictObject({
  action: z.literal('submit'),
  requestId: uuid,
  tenantId: uuid,
  description: text(160).min(1),
  brand: text(100),
  condition: z.enum(['like_new', 'very_good', 'good', 'worn']),
  notes: text(1000),
  desiredPriceOre: z
    .string()
    .regex(/^[1-9]\d{0,10}$/)
    .nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  senderCountry: z.literal('SE').optional(),
  photos: z
    .array(uuid)
    .min(1)
    .max(8)
    .refine((v) => new Set(v).size === v.length),
})
export const externalItemCommand = z.discriminatedUnion('action', [
  externalItemSubmission,
  z.strictObject({
    action: z.literal('list'),
    offset: z.number().int().min(0).max(100000).default(0),
    requestId: uuid.nullable().default(null),
  }),
  z.strictObject({ action: z.literal('discardPhoto'), photoId: uuid }),
])

const errorCodes = new Set([
  'PHONE_VERIFICATION_REQUIRED',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'ACTIVE_REQUEST_LIMIT',
  'STORE_UNAVAILABLE',
  'STORE_CHANGED',
  'SWEDEN_REQUIRED',
  'PHOTO_NOT_FOUND',
  'PHOTO_LIMIT',
  'PHOTO_IN_USE',
  'PHOTO_STILL_STORED',
  'PLAN_READ_ONLY',
  'REQUEST_CHANGED',
  'REQUEST_NOT_FOUND',
])
function checkError(error: { message: string } | null) {
  if (error)
    throw new Error(
      errorCodes.has(error.message) ? error.message : 'REQUEST_FAILED',
    )
}
const photoPath = z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/)
const externalRequest = z.object({
  id: z.uuid(),
  tenant_id: z.uuid(),
  store_name: z.string(),
  description: z.string(),
  brand: z.string(),
  condition: externalItemSubmission.shape.condition,
  notes: z.string(),
  desired_price_ore: externalItemSubmission.shape.desiredPriceOre,
  currency: externalItemSubmission.shape.currency,
  photos: externalItemSubmission.shape.photos,
  sender_country: z.literal('SE').nullable().optional(),
  created_at: z.iso.datetime({ offset: true }),
  status: z.enum(['waiting', 'declined']),
  decline_note: z.string().nullable(),
})
export const externalRequestPage = z.object({
  activeCount: z.number().int().min(0).max(10),
  hasMore: z.boolean(),
  requests: z.array(externalRequest).max(25),
})

export async function executeExternalItemCommand(
  client: SupabaseClient,
  input: unknown,
) {
  const c = externalItemCommand.parse(input)
  if (c.action === 'submit') {
    const result = await client.rpc('submit_external_item_request', {
      p_id: c.requestId,
      p_tenant: c.tenantId,
      p_description: c.description,
      p_brand: c.brand,
      p_condition: c.condition,
      p_notes: c.notes,
      p_price_ore: c.desiredPriceOre,
      p_currency: c.currency,
      p_photos: c.photos,
      p_sender_country: c.senderCountry ?? null,
    })
    checkError(result.error)
    if (result.data !== c.requestId) throw new Error('UNCONFIRMED_RESULT')
    return { id: c.requestId }
  }
  if (c.action === 'list') {
    const result = await client.rpc('my_external_item_requests', {
      p_offset: c.offset,
      p_id: c.requestId,
    })
    checkError(result.error)
    return externalRequestPage.parse(result.data)
  }
  const claimed = await client.rpc('discard_external_item_photo', {
    p_id: c.photoId,
  })
  checkError(claimed.error)
  // A confirmed prior cleanup may have lost its response. Missing owned
  // reservations are already clean; never infer a Storage path from the caller.
  if (claimed.data === null) return { id: c.photoId }
  const path = photoPath.parse(claimed.data)
  if (!path.endsWith(`/${c.photoId}.jpg`)) throw new Error('UNCONFIRMED_RESULT')
  const removed = await client.storage
    .from('external-item-photos')
    .remove([path])
  if (removed.error) throw new Error('PHOTO_UPLOAD_FAILED')
  const finished = await client.rpc('finish_external_item_photo_discard', {
    p_id: c.photoId,
  })
  checkError(finished.error)
  return { id: c.photoId }
}

/** Immutable, metadata-free JPEGs reuse the established reception sanitizer. */
export async function uploadExternalItemPhoto(
  client: SupabaseClient,
  id: string,
  bytes: Uint8Array,
) {
  const photoId = uuid.parse(id)
  photoType(bytes)
  const photo = await receptionDerivative(bytes)
  const reservation = await client.rpc('reserve_external_item_photo', {
    p_id: photoId,
    p_sha256: createHash('sha256').update(photo).digest('hex'),
    p_bytes: photo.byteLength,
  })
  checkError(reservation.error)
  const path = photoPath.parse(reservation.data)
  if (!path.endsWith(`/${photoId}.jpg`)) throw new Error('UNCONFIRMED_RESULT')
  const bucket = client.storage.from('external-item-photos')
  const result = await bucket.upload(path, photo, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '0',
  })
  if (result.error) {
    const prior = await bucket.download(path)
    if (
      prior.error ||
      !prior.data ||
      prior.data.size > 1048576 ||
      !Buffer.from(await prior.data.arrayBuffer()).equals(photo)
    )
      throw new Error('PHOTO_UPLOAD_FAILED')
  }
  return { id: photoId }
}
