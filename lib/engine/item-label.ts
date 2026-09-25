import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const itemLabel = z.object({
  id: z.guid(),
  reference: z.string().regex(/^I-[0-9A-F]{8}$/),
  title: z.string().nullable(),
  priceOre: z.string().regex(/^\d+$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
})

/** Read only; null also supports an application-before-migration rollout. */
export async function readItemLabel(
  client: SupabaseClient,
  tenant: string,
  item: string,
) {
  const result = await client.rpc('item_label_facts', {
    p_tenant: z.uuid().parse(tenant),
    p_item: z.guid().parse(item),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('Unable to read item label')
  return result.data === null ? null : itemLabel.parse(result.data)
}
