import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readBagReceivedItems } from './bag-received-items'
import { itemStage } from './items'
const page = z.object({
  items: z
    .array(
      z.object({
        id: z.guid(),
        session_id: z.guid().nullable(),
        title: z.string().nullable(),
        price_ore: z.string().regex(/^\d+$/).nullable(),
        photo_id: z.guid().nullable(),
        stage: itemStage.nullable().default(null),
        sold_price_ore: z.string().regex(/^\d+$/).nullable().default(null),
      }),
    )
    .max(25),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
})
export async function readBagRegisteredItems(
  client: SupabaseClient,
  tenant: string,
  bag: string,
  offset: number,
) {
  const result = await client.rpc('bag_registered_items_page', {
    p_tenant: z.uuid().parse(tenant),
    p_bag: z.uuid().parse(bag),
    p_offset: z.number().int().nonnegative().parse(offset),
  })
  if (result.error?.code === 'PGRST202') {
    const fallback = await readBagReceivedItems(client, tenant, bag, offset)
    return {
      ...fallback,
      items: fallback.items.map((item) => ({
        ...item,
        stage: null,
        sold_price_ore: null,
      })),
      scope: 'quick' as const,
    }
  }
  if (result.error) throw new Error('Unable to read registered handover items')
  return { ...page.parse(result.data), legacy: false, scope: 'all' as const }
}
export type BagRegisteredPage = Awaited<
  ReturnType<typeof readBagRegisteredItems>
>
