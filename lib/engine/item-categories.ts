import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const labels = z.partialRecord(
  z.enum(['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']),
  z.string().trim().min(1).max(120),
)
export const itemCategory = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  labels,
  version: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
})
export type ItemCategory = z.infer<typeof itemCategory>
export const createCategoryInput = z
  .strictObject({
    tenantId: z.uuid(),
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    labels,
  })
  .refine((c) => Object.keys(c.labels).length > 0)

export function categoryName(
  category: Pick<ItemCategory, 'name' | 'labels'>,
  locale: string,
) {
  return (
    category.labels[locale as keyof typeof category.labels] ??
    category.labels.en ??
    category.name
  )
}
export async function readItemCategories(
  client: SupabaseClient,
  tenantId: string,
): Promise<ItemCategory[]> {
  const { data, error } = await client.rpc('item_category_catalogue', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (error) throw new Error('Unable to read item categories')
  return z.array(itemCategory).parse(data)
}

/** The ID is the selection; names stay readable even when translations overlap. */
export function categoryChoices(categories: ItemCategory[], locale: string) {
  const active = categories.filter((c) => c.active)
  const names = active.map((c) => categoryName(c, locale))
  return active.map((c, index) => ({
    id: c.id,
    name: names[index],
    label:
      names.filter((n) => n === names[index]).length > 1
        ? `${names[index]} (${c.name})`
        : names[index],
  }))
}
export async function createItemCategory(
  client: SupabaseClient,
  input: unknown,
) {
  const c = createCategoryInput.parse(input)
  const { data, error } = await client.rpc('create_item_category', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_name: c.name,
    p_labels: c.labels,
  })
  if (error)
    throw new Error(
      [
        'FORBIDDEN',
        'AUTH_REQUIRED',
        'REQUEST_CONFLICT',
        'INVALID_INPUT',
        'CATEGORY_EXISTS',
      ].includes(error.message)
        ? error.message
        : 'REQUEST_FAILED',
    )
  if (data !== c.requestId) throw new Error('REQUEST_FAILED')
  return {
    ok: true,
    id: data,
    category: { id: data, name: c.name, labels: c.labels },
  }
}
