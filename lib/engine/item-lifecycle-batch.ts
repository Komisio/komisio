import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const reason = z.string().trim().min(1).max(500)
export const lifecycleBatchOperation = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('end'),
    endAction: z.enum(['return', 'charity', 'recycle']),
    reason: z.string().trim().max(500),
  }),
  z.strictObject({
    kind: z.literal('extend'),
    days: z.number().int().min(1).max(365),
    reason,
  }),
  z.strictObject({
    kind: z.literal('setPrice'),
    priceOre: z.number().int().min(1).max(99_999_999_999),
    reason: z.string().trim().max(500),
  }),
  z.strictObject({ kind: z.literal('markdown') }),
])
export const lifecycleSkipReason = z.enum([
  'missing',
  'sold',
  'ended',
  'markdown_not_due',
  'collection_not_due',
  'changed',
])
export const lifecycleBatchPreviewRow = z.strictObject({
  itemId: z.guid(),
  title: z.string(),
  token: z.string().regex(/^([a-f0-9]{32})?$/),
  eligible: z.boolean(),
  reason: lifecycleSkipReason.nullable(),
  priceOre: z.number().int().nullable(),
  periodEnd: z.iso.datetime({ offset: true }).nullable(),
  step: z.number().int().nullable(),
})
export const lifecycleBatchPreview = z
  .array(lifecycleBatchPreviewRow)
  .min(1)
  .max(50)
export const lifecycleBatchResult = z.strictObject({
  id: z.uuid(),
  items: z
    .array(
      z.strictObject({
        itemId: z.guid(),
        status: z.enum(['applied', 'skipped']),
        reason: lifecycleSkipReason.nullable(),
        eventId: z.uuid().nullable(),
      }),
    )
    .min(1)
    .max(50),
})
export const lifecycleBatchCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('preview'),
    tenantId: z.uuid(),
    items: z
      .array(z.guid())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
    operation: lifecycleBatchOperation,
  }),
  z.strictObject({
    action: z.literal('apply'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    operation: lifecycleBatchOperation,
    preview: lifecycleBatchPreview,
  }),
])
export type LifecycleBatchCommand = z.infer<typeof lifecycleBatchCommand>
export type LifecycleBatchPreview = z.infer<typeof lifecycleBatchPreview>
export type LifecycleBatchResult = z.infer<typeof lifecycleBatchResult>

export async function executeLifecycleBatch(
  client: SupabaseClient,
  input: unknown,
) {
  const c = lifecycleBatchCommand.parse(input)
  const result =
    c.action === 'preview'
      ? await client.rpc('preview_item_lifecycle_batch', {
          p_tenant: c.tenantId,
          p_items: c.items,
          p_operation: c.operation,
        })
      : await client.rpc('apply_item_lifecycle_batch', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_operation: c.operation,
          p_preview: c.preview,
        })
  if (result.error)
    throw new Error(
      result.error.code === '42501'
        ? 'FORBIDDEN'
        : result.error.message.includes('REQUEST_CONFLICT')
          ? 'REQUEST_CONFLICT'
          : 'REQUEST_FAILED',
    )
  return c.action === 'preview'
    ? lifecycleBatchPreview.parse(result.data)
    : lifecycleBatchResult.parse(result.data)
}
