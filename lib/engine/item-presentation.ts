import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
export const editDescriptionInput = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  itemId: z.guid(),
  expected: z.string().max(1000),
  title: z.string().trim().min(1).max(1000),
})
export async function editItemDescription(
  client: SupabaseClient,
  input: unknown,
) {
  const c = editDescriptionInput.parse(input)
  const r = await client.rpc('edit_item_description', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_item: c.itemId,
    p_expected: c.expected,
    p_title: c.title,
  })
  if (r.error)
    throw new Error(
      [
        'ITEM_CHANGED',
        'ITEM_NOT_FOUND',
        'REQUEST_CONFLICT',
        'INVALID_INPUT',
        'FORBIDDEN',
      ].find((code) => r.error!.message.includes(code)) ?? 'REQUEST_FAILED',
    )
  return z
    .object({
      corrected: z.literal(true),
      replayed: z.boolean(),
      slug: z.literal('description'),
      value: z.string(),
    })
    .parse(r.data)
}
