import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
const fields = z
  .array(
    z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .refine((v) => !['description', 'category'].includes(v)),
  )
  .max(4)
  .refine((v) => new Set(v).size === v.length)
  .nullable()
export const itemLabelFields = z.object({
  revision: z.number().int().nonnegative(),
  fields,
})
export type ItemLabelFields = z.infer<typeof itemLabelFields>
export const setItemLabelFieldsCommand = z.strictObject({
  action: z.literal('setItemLabelFields'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  fields,
})
export async function readItemLabelFields(
  client: SupabaseClient,
  tenantId: string,
) {
  const result = await client.rpc('item_label_fields', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('Unable to read label fields')
  return itemLabelFields.parse(result.data)
}
