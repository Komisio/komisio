import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionDerivative } from '../media/reception-image'
import { photoType } from '../media/reception-photo'
import { submissionSuggestion } from '../assistance/submission-suggestion'

export const submissionSettings = z.object({
  enabled: z.boolean(),
  pricing: z.enum(['store', 'seller', 'approval']),
  currency: z.string().regex(/^[A-Z]{3}$/),
})
export type SubmissionSettings = z.infer<typeof submissionSettings>
export async function readSubmissionSettings(
  client: SupabaseClient,
  tenantId: string,
  sellerId: string,
) {
  const result = await client.rpc('my_submission_settings', {
    p_tenant: z.uuid().parse(tenantId),
    p_seller: z.uuid().parse(sellerId),
  })
  if (result.error) throw new Error('FORBIDDEN')
  return submissionSettings.parse(result.data)
}
const context = { tenantId: z.uuid(), sellerId: z.uuid() }
export const submitItemsCommand = z.strictObject({
  ...context,
  requestId: z.uuid(),
  previousId: z.uuid().nullable(),
  assistanceId: z.uuid().optional(),
  price: z
    .string()
    .regex(/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/)
    .nullable()
    .optional(),
  pricing: submissionSettings.shape.pricing.default('store'),
  currency: submissionSettings.shape.currency.optional(),
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
    priceApproved: z.boolean().default(false),
  })
  .refine((v) => v.decision !== 'more_information' || v.note.length > 0)
export async function submitSellerItems(
  client: SupabaseClient,
  input: unknown,
) {
  const c = submitItemsCommand.parse(input)
  const r = await client.rpc('submit_my_assisted_items', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_seller: c.sellerId,
    p_previous: c.previousId,
    p_description: c.description,
    p_photos: c.photos,
    p_assistance: c.assistanceId ?? null,
    p_price: c.price ?? null,
    p_pricing: c.pricing,
    p_currency: c.currency ?? null,
  })
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
    p_price_approved: c.priceApproved,
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
  pricing_mode: submissionSettings.shape.pricing,
  seller_price: z.string().nullable(),
  price_currency: z.string().nullable(),
  price_approved: z.boolean().nullable(),
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
      'SUBMISSIONS_DISABLED',
      'SUBMISSION_NOT_FOUND',
      'REQUEST_CONFLICT',
    ].find((c) => c === message) ?? 'REQUEST_FAILED'
  )
}

export const submissionQueueFilter = z.enum([
  'all',
  'pending',
  'invited',
  'registered',
])
export async function readSubmissionQueue(
  client: SupabaseClient,
  tenantId: string,
  page: number,
  filter: z.infer<typeof submissionQueueFilter> = 'all',
  query = '',
) {
  const result = await client.rpc('submission_queue', {
    p_tenant: z.uuid().parse(tenantId),
    p_offset: (z.number().int().min(1).max(100000).parse(page) - 1) * 25,
    p_filter: submissionQueueFilter.parse(filter),
    p_query: z.string().trim().max(100).parse(query),
  })
  if (result.error) throw new Error('REQUEST_FAILED')
  const row = z.object({
    id: z.uuid(),
    seller_id: z.uuid(),
    description: z.string(),
    photos: z.array(z.string()),
    created_at: z.string(),
    pricing_mode: submissionSettings.shape.pricing,
    seller_price: z.union([z.number(), z.string()]).nullable(),
    price_currency: z.string().nullable(),
    assistance_output: z
      .object({ suggestion: submissionSuggestion, currency: z.string() })
      .nullable(),
    sellers: z.object({ name: z.string() }).nullable(),
    item_id: z.uuid().nullable(),
    submission_receptions: z.array(z.object({ session_id: z.uuid() })),
    seller_submission_reviews: z.array(
      z.object({
        id: z.uuid(),
        decision: z.enum(['invite', 'more_information', 'decline']),
        note: z.string(),
        price_approved: z.boolean(),
      }),
    ),
  })
  return z
    .object({
      rows: z.array(row).max(25),
      total: z.number().int().nonnegative(),
    })
    .parse(result.data)
}
