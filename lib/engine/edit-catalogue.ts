import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { itemTypeProfile } from './attributes'
import { readItemCategories } from './item-categories'

const labels = z
  .partialRecord(
    z.enum(['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']),
    z.string().trim().min(1).max(120),
  )
  .refine((v) => Object.keys(v).length > 0)
export const catalogueEditCommand = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('category'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    id: z.uuid(),
    expected: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(120),
    labels,
    active: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('type'),
    tenantId: z.uuid(),
    slug: itemTypeProfile.shape.slug,
    expected: itemTypeProfile,
    payload: z.strictObject({
      labels,
      suggestedCategory: z.string().trim().max(120).optional(),
      suggestedCategoryId: z.uuid().nullable().optional(),
      active: z.boolean(),
      attributes: itemTypeProfile.shape.attributes
        .max(100)
        .refine((a) => new Set(a.map((v) => v.slug)).size === a.length),
    }),
  }),
])
export async function editCatalogue(client: SupabaseClient, input: unknown) {
  const c = catalogueEditCommand.parse(input)
  const result =
    c.kind === 'category'
      ? await client.rpc('update_item_category', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_category: c.id,
          p_expected: c.expected,
          p_name: c.name,
          p_labels: c.labels,
          p_active: c.active,
        })
      : await client.rpc('update_item_type', {
          p_tenant: c.tenantId,
          p_slug: c.slug,
          p_expected: c.expected,
          p_payload: c.payload,
        })
  if (result.error)
    throw new Error(
      [
        'FORBIDDEN',
        'AUTH_REQUIRED',
        'INVALID_INPUT',
        'REQUEST_CONFLICT',
        'CATALOGUE_CHANGED',
        'CATEGORY_EXISTS',
        'ITEM_TYPE_NAME_EXISTS',
        'CATEGORY_NOT_FOUND',
        'ITEM_TYPE_UNDEFINED',
      ].includes(result.error.message)
        ? result.error.message
        : 'REQUEST_FAILED',
    )
  if (c.kind === 'type')
    return { ok: true, profile: itemTypeProfile.parse(result.data) }
  if (result.data !== c.requestId) throw new Error('REQUEST_FAILED')
  const category = (await readItemCategories(client, c.tenantId)).find(
    (v) => v.id === c.id,
  )
  if (!category) throw new Error('CATEGORY_NOT_FOUND')
  return { ok: true, id: c.requestId, category }
}
