import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
const row = z.object({
  id: z.guid(),
  session_id: z.guid(),
  title: z.string().nullable(),
  price_ore: z.string().regex(/^\d+$/).nullable(),
  photo_id: z.uuid().nullable(),
})
const page = z.object({
  items: z.array(row).max(25),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
})
export async function readBagReceivedItems(
  client: SupabaseClient,
  tenant: string,
  bag: string,
  offset: number,
) {
  const args = { p_tenant: z.uuid().parse(tenant), p_bag: z.uuid().parse(bag) }
  const result = await client.rpc('bag_received_items_page', {
    ...args,
    p_offset: z.number().int().nonnegative().parse(offset),
  })
  // Application deployment may precede the additive database migration.
  if (result.error?.code === 'PGRST202') {
    const legacy = await client.rpc('bag_received_items', args)
    if (legacy.error) throw new Error('Unable to read bag items')
    const items = z.array(row).max(50).parse(legacy.data)
    return { items, total: items.length, offset: 0, legacy: true }
  }
  if (result.error) throw new Error('Unable to read bag items')
  return { ...page.parse(result.data), legacy: false }
}
