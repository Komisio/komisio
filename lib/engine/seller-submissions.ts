import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionDerivative } from '../media/reception-image'
import { photoType } from '../media/reception-photo'
import { submissionSuggestion } from '../assistance/submission-suggestion'

const context = { tenantId: z.uuid(), sellerId: z.uuid() }
export const submitItemsCommand = z.strictObject({
  ...context,
  requestId: z.uuid(),
  previousId: z.uuid().nullable(),
  assistanceId: z.uuid().optional(),
  description: z.string().trim().min(1).max(2000),
  photos: z
    .array(z.string().max(200))
    .min(1)
    .max(8)
    .refine((v) => new Set(v).size === v.length),
})
export const reviewSubmissionCommand = z
  .strictObject({
    tenantId: z.uuid(),
    requestId: z.uuid(),
    submissionId: z.uuid(),
    decision: z.enum(['invite', 'more_information', 'decline']),
    note: z.string().trim().max(1000),
  })
  .refine((v) => v.decision !== 'more_information' || v.note.length > 0)
export async function submitSellerItems(
  client: SupabaseClient,
  input: unknown,
) {
  const c = submitItemsCommand.parse(input)
  const r = await client.rpc(
    c.assistanceId ? 'submit_my_assisted_items' : 'submit_my_items',
    {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_seller: c.sellerId,
      p_previous: c.previousId,
      p_description: c.description,
      p_photos: c.photos,
      ...(c.assistanceId ? { p_assistance: c.assistanceId } : {}),
    },
  )
  if (r.error) throw new Error(submissionError(r.error.message))
  if (r.data !== c.requestId) throw new Error('UNCONFIRMED_RESULT')
  return { id: c.requestId }
}
export async function reviewSellerSubmission(
  client: SupabaseClient,
  input: unknown,
) {
  const c = reviewSubmissionCommand.parse(input)
  const r = await client.rpc('review_seller_submission', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_submission: c.submissionId,
    p_decision: c.decision,
    p_note: c.note,
  })
  if (r.error) throw new Error(submissionError(r.error.message))
  if (r.data !== c.requestId) throw new Error('UNCONFIRMED_RESULT')
  return { id: c.requestId }
}
export const submissionRow = z.object({
  id: z.uuid(),
  previous_id: z.uuid().nullable(),
  description: z.string(),
  photos: z.array(z.string()),
  created_at: z.iso.datetime({ offset: true }),
  decision: z.enum(['invite', 'more_information', 'decline']).nullable(),
  note: z.string().nullable(),
  assistance_output: z
    .object({ suggestion: submissionSuggestion, currency: z.string() })
    .nullable(),
})
export async function readMySubmissions(
  client: SupabaseClient,
  input: unknown,
) {
  const c = z.strictObject(context).parse(input)
  const r = await client.rpc('my_item_submissions', {
    p_tenant: c.tenantId,
    p_seller: c.sellerId,
  })
  if (r.error) throw new Error(submissionError(r.error.message))
  return z.array(submissionRow).max(50).parse(r.data)
}

/** Reuses image sanitization, but never staff reception storage or permissions. */
export async function uploadSellerSubmissionPhoto(
  client: SupabaseClient,
  input: unknown,
  bytes: Uint8Array,
) {
  const c = z.strictObject({ ...context, photoId: z.uuid() }).parse(input)
  const path = `${c.tenantId}/${c.sellerId}/${c.photoId}.jpg`
  const allowed = await client.rpc('seller_submission_photo_access', {
    p_name: path,
    p_write: true,
  })
  if (allowed.error || allowed.data !== true) throw new Error('FORBIDDEN')
  photoType(bytes)
  const photo = await receptionDerivative(bytes)
  const bucket = client.storage.from('seller-submission-photos')
  const r = await bucket.upload(path, photo, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '0',
  })
  if (r.error) {
    const prior = await bucket.download(path)
    if (
      prior.error ||
      prior.data.size > 1048576 ||
      !Buffer.from(await prior.data.arrayBuffer()).equals(photo)
    )
      throw new Error('PHOTO_UPLOAD_FAILED')
  }
  return { path }
}
export function submissionError(message: string) {
  return (
    [
      'FORBIDDEN',
      'AUTH_REQUIRED',
      'INVALID_INPUT',
      'PHOTO_NOT_FOUND',
      'SUBMISSION_CHANGED',
      'SUBMISSION_NOT_FOUND',
      'REQUEST_CONFLICT',
    ].find((c) => c === message) ?? 'REQUEST_FAILED'
  )
}

export async function readSubmissionQueue(
  client: SupabaseClient,
  tenantId: string,
  page: number,
) {
  z.uuid().parse(tenantId)
  z.number().int().min(1).max(100000).parse(page)
  const result = await client
    .from('seller_submissions')
    .select(
      'id,seller_id,description,photos,created_at,assistance_output,sellers(name),seller_submission_reviews(decision,note)',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * 25, page * 25 - 1)
  if (result.error) throw new Error('REQUEST_FAILED')
  const row = z.object({
    id: z.uuid(),
    seller_id: z.uuid(),
    description: z.string(),
    photos: z.array(z.string()),
    created_at: z.string(),
    assistance_output: z
      .object({ suggestion: submissionSuggestion, currency: z.string() })
      .nullable(),
    sellers: z.object({ name: z.string() }).nullable(),
    seller_submission_reviews: z.array(
      z.object({
        decision: z.enum(['invite', 'more_information', 'decline']),
        note: z.string(),
      }),
    ),
  })
  return { rows: z.array(row).parse(result.data), total: result.count ?? 0 }
}
