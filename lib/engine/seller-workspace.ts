import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { itemStage } from './items'
const workspaceItems = z.object({
  items: z
    .array(
      z.object({
        id: z.guid(),
        title: z.string().nullable(),
        category: z.string().nullable(),
        stage: itemStage,
        acceptedAt: z.string(),
        priceOre: z
          .union([z.number().int(), z.string()])
          .transform(Number)
          .nullable(),
      }),
    )
    .max(25),
  total: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
  limit: z.literal(25),
})
export async function readSellerWorkspaceItems(
  client: SupabaseClient,
  tenant: string,
  seller: string,
  page = 0,
) {
  const result = await client.rpc('seller_workspace_items', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
    p_page: z.number().int().min(0).max(1000000).parse(page),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('Unable to read seller items')
  return workspaceItems.parse(result.data)
}
