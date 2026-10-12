import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { itemStage } from './items'
export const sellerItemSort = z.enum([
  'title',
  'category',
  'price',
  'stage',
  'accepted',
])
export const sellerItemSearch = z.object({
  page: z.number().int().min(0).max(1000000).default(0),
  query: z.string().trim().max(120).default(''),
  stage: z.union([itemStage, z.literal('')]).default(''),
  sort: sellerItemSort.default('accepted'),
  direction: z.enum(['asc', 'desc']).default('desc'),
})
export type SellerItemSearch = z.infer<typeof sellerItemSearch>
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
        // Older database revisions do not expose the sale field yet. Never
        // substitute current list price for an unknown sale amount.
        soldPriceOre: z
          .union([z.number().int(), z.string()])
          .transform(Number)
          .nullable()
          .default(null),
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

export async function searchSellerWorkspaceItems(
  client: SupabaseClient,
  tenant: string,
  seller: string,
  input: SellerItemSearch,
) {
  const options = sellerItemSearch.parse(input)
  const result = await client.rpc('seller_workspace_items_search', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
    p_page: options.page,
    p_query: options.query,
    p_stage: options.stage,
    p_sort: options.sort,
    p_direction: options.direction,
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('Unable to search seller items')
  return workspaceItems.parse(result.data)
}
