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

export function categoryName(category: ItemCategory, locale: string) {
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
  const { data, error } = await client
    .from('item_categories')
    .select('id,name,labels')
    .eq('tenant_id', z.uuid().parse(tenantId))
    .order('name')
    .limit(1000)
  if (error) throw new Error('Unable to read item categories')
  return z.array(itemCategory).parse(data)
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
